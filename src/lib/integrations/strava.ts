import { ActivityEquivalence, ActivityPriority, ActivityType, ExternalAccount, Units } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildPlanActivityActualsUpdate } from '@/lib/activity-actuals';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { createIntegrationStateToken } from '@/lib/integrations/state';
import { isDayClosed, setDayStatus } from '@/lib/day-status';
import { pickSelectedPlan } from '@/lib/plan-selection';
import { resolveDistanceUnitFromActivity } from '@/lib/unit-display';
import { evaluateStravaEquivalence } from '@/lib/integrations/strava-equivalence';

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';

type StravaTokenResponse = {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: {
    id?: number;
    username?: string | null;
    firstname?: string | null;
    lastname?: string | null;
  };
};

type StravaActivity = {
  id: number;
  name?: string;
  sport_type?: string;
  start_date?: string;
  start_date_local?: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  calories?: number;
  total_elevation_gain?: number;
};

type PlannedActivityCandidate = {
  id: string;
  dateKey: string;
  title: string;
  type: ActivityType;
  subtype: string | null;
  paceTargetBucket: string | null;
  priority: ActivityPriority | null;
  mustDo: boolean;
  distanceM: number | null;
  durationSec: number | null;
  completed: boolean;
  actualDistance: number | null;
  actualDuration: number | null;
  actualPace: string | null;
  completedAt: Date | null;
  notes: string | null;
  sessionGroupId: string | null;
  sessionOrder: number | null;
};

export type StravaSyncSummary = {
  imported: number;
  matched: number;
  workoutsUpdated: number;
  latestActivityEpoch: number | null;
  fetched: number;
  afterEpoch: number;
  afterDate: string;
  truncated?: boolean;
};

type PlanActivityCandidates = {
  byDate: Map<string, PlannedActivityCandidate[]>;
  byId: Map<string, PlannedActivityCandidate>;
  planId: string | null;
  lockedDateSet: Set<string>;
};

type MatchScoreResult = {
  score: number;
  reason: string;
};

type DayMatchInput = {
  externalId: string;
  sportType: string | null;
  durationSec: number | null;
  distanceM: number | null;
  existingPlanActivityId?: string | null;
};

type DayMatchDecision = {
  externalId: string;
  matchedPlanActivityId: string | null;
  score: number | null;
  reason: string | null;
  sessionMemberIds?: string[];
};

export type StravaDayImportSummary = {
  date: string;
  stravaActivities: number;
  matched: number;
  workoutsUpdated: number;
  unmatched: number;
  decisions: StravaMatchDecision[];
  /** True when the day is a pure rest day and a Strava activity was found — day is auto-marked done. */
  restDayAutoCompleted?: boolean;
};

export type StravaMatchDecision = {
  externalActivityId: string;
  externalName: string | null;
  sportType: string | null;
  planActivityId: string | null;
  planActivityTitle: string | null;
  equivalence: ActivityEquivalence | null;
  equivalenceOverride: ActivityEquivalence | null;
  loadRatio: number | null;
  equivalenceConfidence: number | null;
  equivalenceNote: string | null;
};

function getStravaClientId() {
  return process.env.STRAVA_CLIENT_ID || '';
}

function getStravaClientSecret() {
  return process.env.STRAVA_CLIENT_SECRET || '';
}

export function isStravaConfigured() {
  return Boolean(getStravaClientId() && getStravaClientSecret());
}

function toDateKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getStravaActivityDateKey(activity: StravaActivity): string | null {
  if (typeof activity.start_date_local === 'string' && /^\d{4}-\d{2}-\d{2}/.test(activity.start_date_local)) {
    return activity.start_date_local.slice(0, 10);
  }
  const fromStart = parseIsoDate(activity.start_date);
  if (!fromStart) return null;
  return toDateKey(fromStart);
}

function getStravaActivityStartTime(activity: StravaActivity): Date | null {
  return parseIsoDate(activity.start_date) || parseIsoDate(activity.start_date_local);
}

function getExternalActivityDateKey(activity: { raw: unknown; startTime: Date }): string {
  const raw = activity.raw;
  if (raw && typeof raw === 'object') {
    const asRecord = raw as Record<string, unknown>;
    const local = asRecord.start_date_local;
    if (typeof local === 'string' && /^\d{4}-\d{2}-\d{2}/.test(local)) {
      return local.slice(0, 10);
    }
  }
  return toDateKey(activity.startTime);
}

function isLockedPlanDay(
  notes: string | null | undefined,
  activities: Array<{ completed: boolean }>
) {
  return isDayClosed(notes) || (activities.length > 0 && activities.every((activity) => activity.completed));
}

function buildStravaRedirectUri(origin: string) {
  return `${origin}/api/integrations/strava/callback`;
}

function parseStravaTokenResponse(raw: unknown): StravaTokenResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Unexpected Strava token response');
  }
  return raw as StravaTokenResponse;
}

function mustGetAccessToken(account: ExternalAccount) {
  if (!account.accessToken) throw new Error('No access token found for Strava account');
  return account.accessToken;
}

function mapStravaSportTypeToPlanType(sportType: string | null | undefined): ActivityType {
  const normalized = (sportType || '').toUpperCase();
  if (normalized.includes('RUN')) return 'RUN';
  if (normalized.includes('HIKE') || normalized.includes('WALK')) return 'HIKE';
  if (normalized.includes('YOGA')) return 'YOGA';
  if (normalized.includes('WEIGHT') || normalized.includes('WORKOUT')) return 'STRENGTH';
  if (normalized.includes('RIDE') || normalized.includes('SWIM') || normalized.includes('SKI')) {
    return 'CROSS_TRAIN';
  }
  return 'OTHER';
}

function typeCompatibilityScore(planned: ActivityType, actual: ActivityType) {
  if (planned === 'REST') return -1;
  if (planned === actual) return 100;
  if (actual === 'RUN' && planned === 'HIKE') return 70;
  if (actual === 'HIKE' && planned === 'RUN') return 70;
  if (actual === 'CROSS_TRAIN' && (planned === 'OTHER' || planned === 'HIKE')) return 60;
  if (planned === 'CROSS_TRAIN' && (actual === 'RUN' || actual === 'HIKE' || actual === 'OTHER')) return 60;
  if (planned === 'OTHER') return 45;
  return 0;
}

function convertMetersToUserUnits(distanceM: number, units: Units | null | undefined) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  if (units === 'KM') return distanceM / 1000;
  return distanceM / 1609.344;
}

function formatPace(
  movingTimeSec: number | null | undefined,
  distanceM: number | null | undefined,
  units: Units | null | undefined
) {
  if (!movingTimeSec || !distanceM || movingTimeSec <= 0 || distanceM <= 0) return null;

  const distanceUnits = units === 'KM' ? distanceM / 1000 : distanceM / 1609.344;
  if (!Number.isFinite(distanceUnits) || distanceUnits <= 0) return null;

  const secPerUnit = movingTimeSec / distanceUnits;
  if (!Number.isFinite(secPerUnit) || secPerUnit <= 0) return null;

  let mins = Math.floor(secPerUnit / 60);
  let secs = Math.round(secPerUnit - mins * 60);
  if (secs === 60) {
    mins += 1;
    secs = 0;
  }
  const unitLabel = units === 'KM' ? '/km' : '/mi';
  return `${mins}:${String(secs).padStart(2, '0')} ${unitLabel}`;
}

async function fetchStravaActivities(
  accessToken: string,
  afterEpoch: number,
  maxPagesPerWindow = 20,
  maxWindows = 20
): Promise<{ activities: StravaActivity[]; truncated: boolean }> {
  const byId = new Map<number, StravaActivity>();
  let beforeEpoch: number | null = null;
  let truncated = false;

  for (let window = 1; window <= maxWindows; window += 1) {
    let windowCompleted = false;
    let oldestEpochInWindow: number | null = null;

    for (let page = 1; page <= maxPagesPerWindow; page += 1) {
      const query = new URLSearchParams({
        after: String(afterEpoch),
        per_page: '100',
        page: String(page)
      });
      if (beforeEpoch) query.set('before', String(beforeEpoch));

      const res = await fetch(`${STRAVA_ACTIVITIES_URL}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store'
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Strava activities request failed (${res.status}): ${errorText || 'Unknown error'}`);
      }

      const batchRaw = await res.json().catch(() => []);
      const batch = Array.isArray(batchRaw) ? (batchRaw as StravaActivity[]) : [];

      if (batch.length === 0) {
        windowCompleted = true;
        break;
      }

      for (const activity of batch) {
        byId.set(activity.id, activity);
        const start = getStravaActivityStartTime(activity);
        if (!start) continue;
        const epoch = Math.floor(start.getTime() / 1000);
        oldestEpochInWindow = oldestEpochInWindow === null
          ? epoch
          : Math.min(oldestEpochInWindow, epoch);
      }

      if (batch.length < 100) {
        windowCompleted = true;
        break;
      }
    }

    if (windowCompleted) {
      return { activities: [...byId.values()], truncated };
    }

    if (!oldestEpochInWindow || oldestEpochInWindow <= afterEpoch) {
      truncated = true;
      break;
    }

    beforeEpoch = oldestEpochInWindow - 1;
  }

  return { activities: [...byId.values()], truncated: true };
}

async function refreshStravaToken(account: ExternalAccount) {
  if (!account.refreshToken) throw new Error('No refresh token found for Strava account');

  const body = new URLSearchParams({
    client_id: getStravaClientId(),
    client_secret: getStravaClientSecret(),
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken
  });

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store'
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Failed to refresh Strava token (${res.status}): ${errorText || 'Unknown error'}`);
  }

  const tokenData = parseStravaTokenResponse(await res.json());
  return prisma.externalAccount.update({
    where: { id: account.id },
    data: {
      tokenType: tokenData.token_type || null,
      accessToken: tokenData.access_token || null,
      refreshToken: tokenData.refresh_token || account.refreshToken,
      expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null,
      providerUserId: tokenData.athlete?.id ? String(tokenData.athlete.id) : account.providerUserId,
      providerUsername: tokenData.athlete?.username || account.providerUsername
    }
  });
}

async function ensureFreshStravaAccount(account: ExternalAccount) {
  const now = Date.now();
  const expiresMs = account.expiresAt?.getTime() || 0;
  const shouldRefresh = !account.accessToken || (expiresMs > 0 && expiresMs <= now + 5 * 60 * 1000);
  if (!shouldRefresh) return account;
  return refreshStravaToken(account);
}

async function buildPlanActivityCandidates(
  userId: string,
  preferredPlanId?: string | null,
  fallbackUnits?: Units | null
): Promise<PlanActivityCandidates> {
  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: userId, isTemplate: false },
    orderBy: { createdAt: 'desc' },
    include: {
      weeks: {
        include: {
          days: { include: { activities: true } }
        }
      }
    }
  });
  const plan = pickSelectedPlan(plans, { cookiePlanId: preferredPlanId });

  const map = new Map<string, PlannedActivityCandidate[]>();
  const byId = new Map<string, PlannedActivityCandidate>();
  const lockedDateSet = new Set<string>();
  if (!plan) return { byDate: map, byId, planId: null as string | null, lockedDateSet };

  const weeks = [...plan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((w) => w.weekIndex);

  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: plan.raceDate,
      weekCount: plan.weekCount,
      allWeekIndexes
    });
    for (const day of week.days) {
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      if (!dayDate) continue;
      const key = toDateKey(dayDate);
      if (isLockedPlanDay(day.notes, day.activities || [])) {
        lockedDateSet.add(key);
        continue;
      }
      const row = map.get(key) || [];

      for (const activity of day.activities) {
        const activityDistanceUnit = resolveDistanceUnitFromActivity({
          distanceUnit: activity.distanceUnit,
          paceTarget: activity.paceTarget,
          actualPace: activity.actualPace,
          fallbackUnit: fallbackUnits ?? null
        });
        const distanceM = activity.distance && activityDistanceUnit
          ? activity.distance * (activityDistanceUnit === 'KM' ? 1000 : 1609.344)
          : null;
        const durationSec = activity.duration ? activity.duration * 60 : null;
        row.push({
          id: activity.id,
          dateKey: key,
          title: activity.title || activity.type.replace(/_/g, ' '),
          type: activity.type,
          subtype: activity.subtype ?? null,
          paceTargetBucket: activity.paceTargetBucket ?? null,
          priority: activity.priority ?? null,
          mustDo: activity.mustDo ?? false,
          distanceM,
          durationSec,
          completed: activity.completed,
          actualDistance: activity.actualDistance,
          actualDuration: activity.actualDuration,
          actualPace: activity.actualPace,
          completedAt: activity.completedAt,
          notes: activity.notes,
          sessionGroupId: activity.sessionGroupId ?? null,
          sessionOrder: activity.sessionOrder ?? null,
        });
        byId.set(activity.id, row[row.length - 1]);
      }

      row.sort((a, b) => Number(a.completed) - Number(b.completed));
      map.set(key, row);
    }
  }

  return { byDate: map, byId, planId: plan.id, lockedDateSet };
}

function scorePlannedCandidateMatch(args: {
  candidate: PlannedActivityCandidate;
  actualType: ActivityType;
  durationSec: number | null;
  distanceM: number | null;
  dayPenalty?: number;
  preferExistingMatch?: boolean;
}): MatchScoreResult {
  const {
    candidate,
    actualType,
    durationSec,
    distanceM,
    dayPenalty = 0,
    preferExistingMatch = false
  } = args;

  const typeScore = typeCompatibilityScore(candidate.type, actualType);
  if (typeScore < 0) return { score: Number.NEGATIVE_INFINITY, reason: 'incompatible type' };

  let score = typeScore - dayPenalty;
  const reasons: string[] = [];
  if (candidate.mustDo || candidate.priority === 'KEY') {
    score += 2;
    reasons.push('key session');
  }
  if (candidate.completed) {
    score -= 12;
    reasons.push('already completed');
  }

  if (durationSec && candidate.durationSec) {
    const durationDeltaMin = Math.abs(durationSec - candidate.durationSec) / 60;
    score -= Math.min(durationDeltaMin, 40) * 0.8;
    reasons.push(`duration Δ ${Math.round(durationDeltaMin)}m`);
  }

  if (distanceM && candidate.distanceM) {
    const distanceDeltaKm = Math.abs(distanceM - candidate.distanceM) / 1000;
    score -= Math.min(distanceDeltaKm, 30) * 2;
    reasons.push(`distance Δ ${distanceDeltaKm.toFixed(1)}km`);
  }

  if (preferExistingMatch) {
    score += 8;
    reasons.push('kept existing link');
  }

  return {
    score,
    reason: reasons.join(' · ') || 'type match'
  };
}

function assignBestMatchesForDay(args: {
  inputs: DayMatchInput[];
  candidates: PlannedActivityCandidate[];
  usedPlanActivityIds: Set<string>;
  minScore?: number;
}): DayMatchDecision[] {
  // ── Session group detection ──────────────────────────────────────────────
  // When there is exactly 1 external activity and a session group whose
  // combined planned distance is within 20% of the external distance,
  // match the whole session to the single external activity.
  if (args.inputs.length === 1) {
    const ext = args.inputs[0];

    // Explicit session match: activities share sessionGroupId
    const sessionGroups = new Map<string, PlannedActivityCandidate[]>();
    for (const c of args.candidates) {
      if (c.sessionGroupId && !args.usedPlanActivityIds.has(c.id)) {
        const g = sessionGroups.get(c.sessionGroupId) ?? [];
        g.push(c);
        sessionGroups.set(c.sessionGroupId, g);
      }
    }
    for (const [groupId, members] of sessionGroups) {
      if (members.length < 2) continue;
      const totalPlanned = members.reduce((s, m) => s + (m.distanceM ?? 0), 0);
      if (
        totalPlanned > 0 &&
        ext.distanceM != null &&
        Math.abs((ext.distanceM - totalPlanned) / totalPlanned) <= 0.20
      ) {
        const sorted = [...members].sort((a, b) => (a.sessionOrder ?? 0) - (b.sessionOrder ?? 0));
        const primary = sorted[0];
        for (const m of sorted) args.usedPlanActivityIds.add(m.id);
        return [{
          externalId: ext.externalId,
          matchedPlanActivityId: primary.id,
          sessionMemberIds: sorted.slice(1).map((m) => m.id),
          score: 100,
          reason: `session-match groupId=${groupId}`
        }];
      }
    }

    // Implicit session heuristic for legacy plans (no sessionGroupId):
    // if 2+ uncompleted non-rest candidates all of RUN type with combined
    // distance within 20% of external, treat as implicit session.
    const ungroupedNonRest = args.candidates.filter(
      (c) => !c.sessionGroupId && !args.usedPlanActivityIds.has(c.id) && !c.completed && c.type !== 'REST'
    );
    if (ungroupedNonRest.length >= 2 && ext.distanceM != null) {
      const allRun = ungroupedNonRest.every((c) => c.type === 'RUN');
      const totalPlanned = ungroupedNonRest.reduce((s, c) => s + (c.distanceM ?? 0), 0);
      if (allRun && totalPlanned > 0 && Math.abs((ext.distanceM - totalPlanned) / totalPlanned) <= 0.20) {
        const primary = ungroupedNonRest[0];
        for (const m of ungroupedNonRest) args.usedPlanActivityIds.add(m.id);
        return [{
          externalId: ext.externalId,
          matchedPlanActivityId: primary.id,
          sessionMemberIds: ungroupedNonRest.slice(1).map((m) => m.id),
          score: 90,
          reason: 'implicit-session-match'
        }];
      }
    }
  }

  const minScore = args.minScore ?? 35;
  const pairs: Array<{
    externalId: string;
    candidateId: string;
    score: number;
    reason: string;
  }> = [];

  for (const input of args.inputs) {
    const actualType = mapStravaSportTypeToPlanType(input.sportType);
    for (const candidate of args.candidates) {
      if (args.usedPlanActivityIds.has(candidate.id)) continue;
      const scored = scorePlannedCandidateMatch({
        candidate,
        actualType,
        durationSec: input.durationSec,
        distanceM: input.distanceM,
        preferExistingMatch: Boolean(input.existingPlanActivityId && input.existingPlanActivityId === candidate.id)
      });
      if (scored.score < minScore) continue;
      pairs.push({
        externalId: input.externalId,
        candidateId: candidate.id,
        score: scored.score,
        reason: scored.reason
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score);

  const assignedExternal = new Set<string>();
  const assignedPlanned = new Set<string>();
  const decisions = new Map<string, DayMatchDecision>();

  for (const pair of pairs) {
    if (assignedExternal.has(pair.externalId) || assignedPlanned.has(pair.candidateId)) continue;
    assignedExternal.add(pair.externalId);
    assignedPlanned.add(pair.candidateId);
    decisions.set(pair.externalId, {
      externalId: pair.externalId,
      matchedPlanActivityId: pair.candidateId,
      score: pair.score,
      reason: pair.reason
    });
  }

  for (const input of args.inputs) {
    if (decisions.has(input.externalId)) continue;
    decisions.set(input.externalId, {
      externalId: input.externalId,
      matchedPlanActivityId: null,
      score: null,
      reason: null
    });
  }

  return args.inputs.map((input) => decisions.get(input.externalId) || {
    externalId: input.externalId,
    matchedPlanActivityId: null,
    score: null,
    reason: null
  });
}

function pickHighestScoreCandidate(args: {
  candidates: PlannedActivityCandidate[];
  actualType: ActivityType;
  durationSec: number | null;
  distanceM: number | null;
  blockedPlanActivityIds: Set<string>;
  minScore?: number;
}) {
  const minScore = args.minScore ?? 35;
  let best: { candidate: PlannedActivityCandidate; score: number; reason: string } | null = null;
  for (const candidate of args.candidates) {
    if (args.blockedPlanActivityIds.has(candidate.id)) continue;
    const scored = scorePlannedCandidateMatch({
      candidate,
      actualType: args.actualType,
      durationSec: args.durationSec,
      distanceM: args.distanceM
    });
    if (scored.score < minScore) continue;
    if (!best || scored.score > best.score) {
      best = {
        candidate,
        score: scored.score,
        reason: scored.reason
      };
    }
  }
  return best;
}

function computeEquivalenceForMatch(args: {
  candidate: PlannedActivityCandidate | null;
  sportType: string | null;
  movingTimeSec: number | null;
  elapsedTimeSec: number | null;
  distanceM: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  elevationGainM: number | null;
  matchReason?: string | null;
}): {
  equivalence: ActivityEquivalence | null;
  equivalenceNote: string | null;
  equivalenceConfidence: number | null;
  loadRatio: number | null;
} {
  if (!args.candidate) {
    return {
      equivalence: null,
      equivalenceNote: null,
      equivalenceConfidence: null,
      loadRatio: null
    };
  }

  const result = evaluateStravaEquivalence({
    planned: {
      type: args.candidate.type,
      title: args.candidate.title,
      subtype: args.candidate.subtype,
      paceTargetBucket: args.candidate.paceTargetBucket,
      durationSec: args.candidate.durationSec,
      distanceM: args.candidate.distanceM,
      priority: args.candidate.priority,
      mustDo: args.candidate.mustDo
    },
    actual: {
      sportType: args.sportType,
      movingTimeSec: args.movingTimeSec,
      elapsedTimeSec: args.elapsedTimeSec,
      distanceM: args.distanceM,
      avgHeartRate: args.avgHeartRate,
      maxHeartRate: args.maxHeartRate,
      elevationGainM: args.elevationGainM
    }
  });

  const reasonPrefix = args.matchReason ? `${args.matchReason}. ` : '';
  return {
    equivalence: result.status,
    equivalenceNote: `${reasonPrefix}${result.note}`.trim(),
    equivalenceConfidence: result.confidence,
    loadRatio: result.loadRatio
  };
}

function shouldAutoApplyActuals(
  equivalence: ActivityEquivalence | null | undefined,
  override: ActivityEquivalence | null | undefined,
  confidence: number | null | undefined
) {
  const effective = override || equivalence || null;
  if (!effective) return true;
  if (effective !== 'FULL') return false;
  if (confidence == null) return true;
  return confidence >= 0.55;
}

async function applyMatchedExternalToSession(args: {
  planMembers: PlannedActivityCandidate[];
  externalDistanceM: number | null;
  externalMovingTimeSec: number | null;
  startTime: Date;
  sourceDateKey: string;
  userUnits: Units | null;
}): Promise<number> {
  const totalPlannedDistanceM = args.planMembers.reduce((s, m) => s + (m.distanceM ?? 0), 0);
  let updated = 0;
  for (const member of args.planMembers) {
    const ratio =
      totalPlannedDistanceM > 0 && member.distanceM != null
        ? member.distanceM / totalPlannedDistanceM
        : args.planMembers.length > 0
          ? 1 / args.planMembers.length
          : 0;
    const memberDistanceM = args.externalDistanceM != null ? args.externalDistanceM * ratio : null;
    const memberDurationSec = args.externalMovingTimeSec != null ? args.externalMovingTimeSec * ratio : null;
    const didUpdate = await applyMatchedExternalToWorkout({
      planActivityId: member.id,
      startTime: args.startTime,
      sourceDateKey: args.sourceDateKey,
      distanceM: memberDistanceM,
      durationSec: memberDurationSec,
      userUnits: args.userUnits,
      sourceLabel: 'Strava (session)'
    });
    if (didUpdate) updated += 1;
  }
  return updated;
}

async function applyMatchedExternalToWorkout(args: {
  planActivityId: string;
  startTime: Date;
  sourceDateKey?: string | null;
  distanceM: number | null;
  durationSec: number | null;
  userUnits: Units | null;
  avgHeartRate?: number | null;
  calories?: number | null;
  sourceLabel?: string;
}) {
  const workout = await prisma.planActivity.findUnique({ where: { id: args.planActivityId } });
  if (!workout) return false;

  const storageUnit = resolveDistanceUnitFromActivity({
    distanceUnit: workout.distanceUnit,
    paceTarget: workout.paceTarget,
    actualPace: workout.actualPace,
    fallbackUnit: args.userUnits ?? null
  });
  const distanceInStorageUnits =
    args.distanceM && storageUnit ? convertMetersToUserUnits(args.distanceM, storageUnit) : null;
  const paceInStorageUnits =
    storageUnit ? formatPace(args.durationSec, args.distanceM, storageUnit) : null;

  const distanceInUnits = args.distanceM ? convertMetersToUserUnits(args.distanceM, args.userUnits) : null;
  const durationMinutes = args.durationSec ? Math.max(1, Math.round(args.durationSec / 60)) : null;
  const pace = formatPace(args.durationSec, args.distanceM, args.userUnits);

  const sourceLabel = args.sourceLabel || 'Strava';
  const unitLabel = args.userUnits === 'KM' ? 'km' : 'mi';
  const stats: string[] = [];
  if (distanceInUnits) stats.push(`${distanceInUnits.toFixed(2)} ${unitLabel}`);
  if (durationMinutes) stats.push(`${durationMinutes} min`);
  if (pace) stats.push(`pace ${pace}`);
  if (args.avgHeartRate) stats.push(`avg HR ${args.avgHeartRate} bpm`);
  if (args.calories) stats.push(`${Math.round(args.calories)} cal`);

  const sourceActivityDate = args.sourceDateKey && /^\d{4}-\d{2}-\d{2}$/.test(args.sourceDateKey)
    ? args.sourceDateKey
    : args.startTime.toISOString().slice(0, 10);
  const syncTag = `[Synced from ${sourceLabel} activity ${sourceActivityDate}]`;
  const detailTag = stats.length ? `${syncTag} ${stats.join(' · ')}` : syncTag;
  const cleanedNotes = (workout.notes || '')
    .split('\n')
    .filter((line) => !/\[Synced from /i.test(line))
    .join('\n')
    .trim();
  const nextNotes = cleanedNotes ? `${cleanedNotes}\n${detailTag}` : detailTag;

  await prisma.planActivity.update({
    where: { id: workout.id },
    data: buildPlanActivityActualsUpdate({
      markCompleted: true,
      completedAt: args.startTime,
      inferredDistanceUnit: storageUnit,
      existingDistanceUnit: workout.distanceUnit,
      actualDistance: distanceInStorageUnits ?? workout.actualDistance ?? undefined,
      actualDuration: durationMinutes ?? workout.actualDuration ?? undefined,
      actualPace: paceInStorageUnits ?? workout.actualPace ?? undefined,
      notes: nextNotes
    })
  });

  return true;
}

export function buildStravaAuthorizeUrl(userId: string, origin: string) {
  if (!isStravaConfigured()) {
    throw new Error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be configured');
  }

  const state = createIntegrationStateToken({
    userId,
    provider: 'STRAVA',
    issuedAt: Date.now()
  });

  const redirectUri = buildStravaRedirectUri(origin);
  const query = new URLSearchParams({
    client_id: getStravaClientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'force',
    scope: 'read,activity:read_all',
    state
  });
  return `${STRAVA_AUTH_URL}?${query.toString()}`;
}

export async function exchangeStravaCodeForAccount(args: {
  userId: string;
  code: string;
  origin: string;
}) {
  if (!isStravaConfigured()) {
    throw new Error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be configured');
  }

  const body = new URLSearchParams({
    client_id: getStravaClientId(),
    client_secret: getStravaClientSecret(),
    code: args.code,
    grant_type: 'authorization_code',
    redirect_uri: buildStravaRedirectUri(args.origin)
  });

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store'
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Strava token exchange failed (${res.status}): ${errorText || 'Unknown error'}`);
  }

  const tokenData = parseStravaTokenResponse(await res.json());
  const username = tokenData.athlete?.username || null;

  return prisma.externalAccount.upsert({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: 'STRAVA'
      }
    },
    create: {
      userId: args.userId,
      provider: 'STRAVA',
      providerUserId: tokenData.athlete?.id ? String(tokenData.athlete.id) : null,
      providerUsername: username,
      tokenType: tokenData.token_type || null,
      accessToken: tokenData.access_token || null,
      refreshToken: tokenData.refresh_token || null,
      scopes: 'read,activity:read_all',
      expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null,
      connectedAt: new Date(),
      lastSyncAt: null
    },
    update: {
      providerUserId: tokenData.athlete?.id ? String(tokenData.athlete.id) : null,
      providerUsername: username,
      tokenType: tokenData.token_type || null,
      accessToken: tokenData.access_token || null,
      refreshToken: tokenData.refresh_token || null,
      scopes: 'read,activity:read_all',
      expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null,
      isActive: true
    }
  });
}

export async function disconnectStravaForUser(userId: string) {
  const account = await prisma.externalAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'STRAVA'
      }
    }
  });

  if (!account) {
    return { revokedAtStrava: false, deletedLocalAccount: false };
  }

  let revokedAtStrava = false;
  let accountWithToken = account;
  try {
    accountWithToken = await ensureFreshStravaAccount(account);
  } catch {
    accountWithToken = account;
  }

  if (accountWithToken.accessToken) {
    try {
      const res = await fetch(STRAVA_DEAUTHORIZE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: accountWithToken.accessToken }),
        cache: 'no-store'
      });
      revokedAtStrava = res.ok;
    } catch {
      revokedAtStrava = false;
    }
  }

  const deleted = await prisma.externalAccount.deleteMany({
    where: {
      userId,
      provider: 'STRAVA'
    }
  });

  return {
    revokedAtStrava,
    deletedLocalAccount: deleted.count > 0
  };
}

export async function syncStravaActivitiesForUser(args: {
  userId: string;
  lookbackDays?: number;
  forceLookback?: boolean;
  preferredPlanId?: string | null;
}): Promise<StravaSyncSummary> {
  const account = await prisma.externalAccount.findUnique({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: 'STRAVA'
      }
    }
  });
  if (!account || !account.isActive) {
    throw new Error('Strava is not connected for this athlete');
  }

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { units: true }
  });

  const readyAccount = await ensureFreshStravaAccount(account);
  const accessToken = mustGetAccessToken(readyAccount);

  const lookbackDays = Math.max(1, Math.min(args.lookbackDays || 30, 3650));
  const fallbackAfterEpoch = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
  const cursorEpoch = readyAccount.syncCursor ? Number(readyAccount.syncCursor) : NaN;
  const useCursor = !args.forceLookback && Number.isFinite(cursorEpoch);
  const afterEpoch = useCursor ? cursorEpoch : fallbackAfterEpoch;

  const fetchedActivities = await fetchStravaActivities(accessToken, afterEpoch);
  const activities = fetchedActivities.activities;
  const fetchedProviderIds = new Set(activities.map((activity) => String(activity.id)));

  const [existingMatches, existingForFetched, plannedCandidates] = await Promise.all([
    prisma.externalActivity.findMany({
      where: {
        userId: args.userId,
        provider: 'STRAVA',
        matchedPlanActivityId: { not: null }
      },
      select: { providerActivityId: true, matchedPlanActivityId: true }
    }),
    fetchedProviderIds.size > 0
      ? prisma.externalActivity.findMany({
        where: {
          userId: args.userId,
          provider: 'STRAVA',
          providerActivityId: { in: [...fetchedProviderIds] }
        },
        select: {
          providerActivityId: true,
          matchedPlanActivityId: true
        }
      })
      : Promise.resolve([]),
    buildPlanActivityCandidates(args.userId, args.preferredPlanId, user?.units ?? null)
  ]);
  const existingByProviderId = new Map(existingForFetched.map((row) => [row.providerActivityId, row]));

  const usedPlanActivityIds = new Set(
    existingMatches
      .filter((row) => !fetchedProviderIds.has(row.providerActivityId))
      .map((row) => row.matchedPlanActivityId)
      .filter((value): value is string => typeof value === 'string' && plannedCandidates.byId.has(value))
  );

  const matchesByProviderId = new Map<string, DayMatchDecision>();
  const dayGroups = new Map<string, DayMatchInput[]>();
  for (const activity of activities) {
    const providerActivityId = String(activity.id);
    const dateKey = getStravaActivityDateKey(activity);
    if (!dateKey) continue;
    const durationSec = activity.moving_time || activity.elapsed_time || null;
    const distanceM = activity.distance || null;
    const row = dayGroups.get(dateKey) || [];
    row.push({
      externalId: providerActivityId,
      sportType: activity.sport_type || null,
      durationSec,
      distanceM,
      existingPlanActivityId: existingByProviderId.get(providerActivityId)?.matchedPlanActivityId || null
    });
    dayGroups.set(dateKey, row);
  }

  for (const [dateKey, dayInputs] of dayGroups.entries()) {
    const dayCandidates = plannedCandidates.byDate.get(dateKey) || [];
    if (dayCandidates.length === 0) {
      for (const input of dayInputs) {
        matchesByProviderId.set(input.externalId, {
          externalId: input.externalId,
          matchedPlanActivityId: null,
          score: null,
          reason: null
        });
      }
      continue;
    }

    const dayDecisions = assignBestMatchesForDay({
      inputs: dayInputs,
      candidates: dayCandidates,
      usedPlanActivityIds
    });

    const locallyUsedPlanIds = new Set<string>();
    for (const decision of dayDecisions) {
      if (!decision.matchedPlanActivityId) continue;
      locallyUsedPlanIds.add(decision.matchedPlanActivityId);
      usedPlanActivityIds.add(decision.matchedPlanActivityId);
    }

    for (const decision of dayDecisions) {
      if (decision.matchedPlanActivityId) {
        matchesByProviderId.set(decision.externalId, decision);
        continue;
      }
      const source = dayInputs.find((input) => input.externalId === decision.externalId);
      if (!source) {
        matchesByProviderId.set(decision.externalId, decision);
        continue;
      }

      const remainingNonRest = dayCandidates.filter(
        (candidate) => !usedPlanActivityIds.has(candidate.id) && !locallyUsedPlanIds.has(candidate.id) && candidate.type !== 'REST'
      );
      let fallback: { candidate: PlannedActivityCandidate; score: number; reason: string } | null = null;
      if (remainingNonRest.length === 1) {
        fallback = {
          candidate: remainingNonRest[0],
          score: 34,
          reason: 'single remaining candidate'
        };
      } else if (dayInputs.length === 1 && remainingNonRest.length > 0) {
        fallback = pickHighestScoreCandidate({
          candidates: remainingNonRest,
          actualType: mapStravaSportTypeToPlanType(source.sportType),
          durationSec: source.durationSec,
          distanceM: source.distanceM,
          blockedPlanActivityIds: usedPlanActivityIds,
          minScore: Number.NEGATIVE_INFINITY
        });
      }

      if (fallback) {
        locallyUsedPlanIds.add(fallback.candidate.id);
        usedPlanActivityIds.add(fallback.candidate.id);
        matchesByProviderId.set(decision.externalId, {
          externalId: decision.externalId,
          matchedPlanActivityId: fallback.candidate.id,
          score: fallback.score,
          reason: fallback.reason
        });
      } else {
        matchesByProviderId.set(decision.externalId, decision);
      }
    }
  }

  let imported = 0;
  let matched = 0;
  let workoutsUpdated = 0;
  let latestActivityEpoch: number | null = null;

  for (const activity of activities) {
    const providerActivityId = String(activity.id);
    const startTime = getStravaActivityStartTime(activity);
    if (!startTime || Number.isNaN(startTime.getTime())) continue;

    const startEpoch = Math.floor(startTime.getTime() / 1000);
    latestActivityEpoch = latestActivityEpoch ? Math.max(latestActivityEpoch, startEpoch) : startEpoch;
    const dateKey = getStravaActivityDateKey(activity);
    const durationSec = activity.moving_time || activity.elapsed_time || null;
    const distanceM = activity.distance || null;
    const decision = matchesByProviderId.get(providerActivityId);
    const matchedPlanActivityId = decision?.matchedPlanActivityId || null;
    const matchedCandidate = matchedPlanActivityId
      ? (plannedCandidates.byId.get(matchedPlanActivityId) || null)
      : null;
    const elevationGainM = activity.total_elevation_gain || null;
    const equivalence = computeEquivalenceForMatch({
      candidate: matchedCandidate,
      sportType: activity.sport_type || null,
      movingTimeSec: activity.moving_time || null,
      elapsedTimeSec: activity.elapsed_time || null,
      distanceM,
      avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
      maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
      elevationGainM,
      matchReason: decision?.reason || null
    });

    const record = await prisma.externalActivity.upsert({
      where: {
        provider_providerActivityId: {
          provider: 'STRAVA',
          providerActivityId
        }
      },
      create: {
        accountId: readyAccount.id,
        userId: args.userId,
        provider: 'STRAVA',
        providerActivityId,
        name: activity.name || null,
        sportType: activity.sport_type || null,
        startTime,
        durationSec,
        movingTimeSec: activity.moving_time || null,
        elapsedTimeSec: activity.elapsed_time || null,
        distanceM,
        avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        calories: activity.calories || null,
        elevationGainM,
        avgPaceSecPerKm: durationSec && distanceM && distanceM > 0
          ? durationSec / (distanceM / 1000)
          : null,
        equivalence: equivalence.equivalence,
        equivalenceNote: equivalence.equivalenceNote,
        equivalenceConfidence: equivalence.equivalenceConfidence,
        loadRatio: equivalence.loadRatio,
        raw: activity as unknown as object,
        matchedPlanActivityId
      },
      update: {
        accountId: readyAccount.id,
        name: activity.name || null,
        sportType: activity.sport_type || null,
        startTime,
        durationSec,
        movingTimeSec: activity.moving_time || null,
        elapsedTimeSec: activity.elapsed_time || null,
        distanceM,
        avgHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
        calories: activity.calories || null,
        elevationGainM,
        avgPaceSecPerKm: durationSec && distanceM && distanceM > 0
          ? durationSec / (distanceM / 1000)
          : null,
        equivalence: equivalence.equivalence,
        equivalenceNote: equivalence.equivalenceNote,
        equivalenceConfidence: equivalence.equivalenceConfidence,
        loadRatio: equivalence.loadRatio,
        raw: activity as unknown as object,
        matchedPlanActivityId
      }
    });
    imported += 1;

    if (record.matchedPlanActivityId) {
      matched += 1;
      if (shouldAutoApplyActuals(record.equivalence, record.equivalenceOverride, record.equivalenceConfidence)) {
        const updated = await applyMatchedExternalToWorkout({
          planActivityId: record.matchedPlanActivityId,
          startTime,
          sourceDateKey: dateKey,
          distanceM,
          durationSec,
          userUnits: user?.units ?? null,
          avgHeartRate: record.avgHeartRate,
          calories: record.calories,
          sourceLabel: 'Strava'
        });
        if (updated) workoutsUpdated += 1;
      }
    }
  }

  const previousCursorEpoch = Number.isFinite(cursorEpoch) ? cursorEpoch : null;
  const nextCursorEpoch = fetchedActivities.truncated
    ? (previousCursorEpoch ?? afterEpoch)
    : latestActivityEpoch
      ? Math.max(previousCursorEpoch ?? 0, latestActivityEpoch)
      : (previousCursorEpoch ?? afterEpoch);

  await prisma.externalAccount.update({
    where: { id: readyAccount.id },
    data: {
      lastSyncAt: new Date(),
      syncCursor: String(nextCursorEpoch),
      isActive: true
    }
  });

  return {
    imported,
    matched,
    workoutsUpdated,
    latestActivityEpoch,
    fetched: activities.length,
    afterEpoch,
    afterDate: new Date(afterEpoch * 1000).toISOString().slice(0, 10),
    truncated: fetchedActivities.truncated
  };
}

export async function setStravaActivityMatchForUser(args: {
  userId: string;
  externalActivityId: string;
  planActivityId: string | null;
  applyActuals?: boolean;
  equivalenceOverride?: ActivityEquivalence | null;
}) {
  const external = await prisma.externalActivity.findFirst({
    where: {
      id: args.externalActivityId,
      userId: args.userId,
      provider: 'STRAVA'
    },
    select: {
      id: true,
      matchedPlanActivityId: true,
      startTime: true,
      distanceM: true,
      durationSec: true,
      avgHeartRate: true,
      calories: true,
      equivalence: true,
      equivalenceConfidence: true,
      equivalenceOverride: true
    }
  });
  if (!external) {
    throw new Error('Strava activity not found');
  }

  const activityIdsToCheck = new Set<string>();
  if (external.matchedPlanActivityId) {
    activityIdsToCheck.add(external.matchedPlanActivityId);
  }
  if (args.planActivityId) {
    activityIdsToCheck.add(args.planActivityId);
  }

  const checkedActivities = activityIdsToCheck.size > 0
    ? await prisma.planActivity.findMany({
      where: {
        id: { in: [...activityIdsToCheck] },
        plan: { athleteId: args.userId }
      },
      select: {
        id: true,
        day: {
          select: {
            notes: true,
            activities: {
              select: { completed: true }
            }
          }
        }
      }
    })
    : [];

  const checkedById = new Map(checkedActivities.map((activity) => [activity.id, activity]));

  if (args.planActivityId && !checkedById.has(args.planActivityId)) {
    throw new Error('Plan activity not found');
  }

  if (args.planActivityId) {
    const target = checkedById.get(args.planActivityId);
    const targetDayLocked = target ? isLockedPlanDay(target.day?.notes, target.day?.activities || []) : false;
    if (targetDayLocked) {
      throw new Error('Cannot match Strava activity to a completed day.');
    }
  }

  if (external.matchedPlanActivityId && external.matchedPlanActivityId !== args.planActivityId) {
    const current = checkedById.get(external.matchedPlanActivityId);
    const currentDayLocked = current ? isLockedPlanDay(current.day?.notes, current.day?.activities || []) : false;
    if (currentDayLocked) {
      throw new Error('Cannot change matches on completed days.');
    }
  }

  await prisma.$transaction(async (tx) => {
    if (args.planActivityId) {
      await tx.externalActivity.updateMany({
        where: {
          userId: args.userId,
          provider: 'STRAVA',
          matchedPlanActivityId: args.planActivityId,
          id: { not: args.externalActivityId }
        },
        data: { matchedPlanActivityId: null }
      });
    }

    await tx.externalActivity.update({
      where: { id: args.externalActivityId },
      data: {
        matchedPlanActivity: args.planActivityId
          ? { connect: { id: args.planActivityId } }
          : { disconnect: true },
        ...(args.equivalenceOverride !== undefined
          ? { equivalenceOverride: args.equivalenceOverride }
          : {})
      }
    });
  });

  const refreshedExternal = await prisma.externalActivity.findUnique({
    where: { id: args.externalActivityId },
    select: {
      matchedPlanActivityId: true,
      startTime: true,
      distanceM: true,
      durationSec: true,
      avgHeartRate: true,
      calories: true,
      equivalence: true,
      equivalenceConfidence: true,
      equivalenceOverride: true
    }
  });

  if (args.planActivityId && args.applyActuals !== false && refreshedExternal?.matchedPlanActivityId) {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { units: true }
    });
    if (
      shouldAutoApplyActuals(
        refreshedExternal.equivalence,
        refreshedExternal.equivalenceOverride,
        refreshedExternal.equivalenceConfidence
      )
    ) {
      await applyMatchedExternalToWorkout({
        planActivityId: refreshedExternal.matchedPlanActivityId,
        startTime: refreshedExternal.startTime,
        distanceM: refreshedExternal.distanceM,
        durationSec: refreshedExternal.durationSec,
        avgHeartRate: refreshedExternal.avgHeartRate,
        calories: refreshedExternal.calories,
        userUnits: user?.units ?? null,
        sourceLabel: 'Strava'
      });
    }
  }

  return { ok: true };
}

export async function importStravaDayForUser(args: {
  userId: string;
  date: string;
  preferredPlanId?: string | null;
}): Promise<StravaDayImportSummary> {
  const date = args.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must be in YYYY-MM-DD format');
  }

  const account = await prisma.externalAccount.findUnique({
    where: {
      userId_provider: {
        userId: args.userId,
        provider: 'STRAVA'
      }
    },
    select: { id: true }
  });
  if (!account) throw new Error('Strava is not connected for this athlete');

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { units: true }
  });

  const plannedCandidates = await buildPlanActivityCandidates(args.userId, args.preferredPlanId, user?.units ?? null);
  if (plannedCandidates.lockedDateSet.has(date)) {
    throw new Error('This day is marked completed and locked from Strava import.');
  }
  const dayCandidates = plannedCandidates.byDate.get(date) || [];
  const dayCandidateIds = new Set(dayCandidates.map((candidate) => candidate.id));

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) {
    throw new Error('Invalid date');
  }
  const queryStart = new Date(dayStart);
  queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const queryEnd = new Date(dayStart);
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 2);
  queryEnd.setUTCMilliseconds(-1);

  const candidateExternal = await prisma.externalActivity.findMany({
    where: {
      userId: args.userId,
      provider: 'STRAVA',
      startTime: {
        gte: queryStart,
        lte: queryEnd
      }
    },
    orderBy: [{ startTime: 'asc' }]
  });

  const dayExternal = candidateExternal.filter((activity) => getExternalActivityDateKey(activity) === date);
  const totalDayExternal = dayExternal.length;
  const usedPlanActivityIds = new Set<string>();
  const dayInputs: DayMatchInput[] = dayExternal.map((activity) => ({
    externalId: activity.id,
    sportType: activity.sportType,
    durationSec: activity.durationSec || activity.movingTimeSec || activity.elapsedTimeSec || null,
    distanceM: activity.distanceM || null,
    existingPlanActivityId: activity.matchedPlanActivityId
  }));
  const dayDecisions = assignBestMatchesForDay({
    inputs: dayInputs,
    candidates: dayCandidates,
    usedPlanActivityIds
  });
  const decisionByExternalId = new Map(dayDecisions.map((decision) => [decision.externalId, decision]));

  for (const decision of dayDecisions) {
    if (decision.matchedPlanActivityId) {
      usedPlanActivityIds.add(decision.matchedPlanActivityId);
      continue;
    }
    const source = dayInputs.find((input) => input.externalId === decision.externalId);
    if (!source) continue;

    const remainingNonRest = dayCandidates.filter(
      (candidate) => !usedPlanActivityIds.has(candidate.id) && candidate.type !== 'REST'
    );
    let fallback: { candidate: PlannedActivityCandidate; score: number; reason: string } | null = null;
    if (remainingNonRest.length === 1) {
      fallback = {
        candidate: remainingNonRest[0],
        score: 34,
        reason: 'single remaining candidate'
      };
    } else if (totalDayExternal === 1 && remainingNonRest.length > 0) {
      fallback = pickHighestScoreCandidate({
        candidates: remainingNonRest,
        actualType: mapStravaSportTypeToPlanType(source.sportType),
        durationSec: source.durationSec,
        distanceM: source.distanceM,
        blockedPlanActivityIds: usedPlanActivityIds,
        minScore: Number.NEGATIVE_INFINITY
      });
    }
    if (!fallback) continue;
    usedPlanActivityIds.add(fallback.candidate.id);
    decisionByExternalId.set(decision.externalId, {
      externalId: decision.externalId,
      matchedPlanActivityId: fallback.candidate.id,
      score: fallback.score,
      reason: fallback.reason
    });
  }

  let matched = 0;
  let workoutsUpdated = 0;
  const decisions: StravaMatchDecision[] = [];
  for (const activity of dayExternal) {
    const decision = decisionByExternalId.get(activity.id);
    const matchedPlanActivityId = decision?.matchedPlanActivityId || null;
    const matchedCandidate = matchedPlanActivityId ? (plannedCandidates.byId.get(matchedPlanActivityId) || null) : null;
    const durationSec = activity.durationSec || activity.movingTimeSec || activity.elapsedTimeSec || null;
    const distanceM = activity.distanceM || null;
    const equivalence = computeEquivalenceForMatch({
      candidate: matchedCandidate,
      sportType: activity.sportType,
      movingTimeSec: activity.movingTimeSec || activity.durationSec || null,
      elapsedTimeSec: activity.elapsedTimeSec || null,
      distanceM,
      avgHeartRate: activity.avgHeartRate,
      maxHeartRate: activity.maxHeartRate,
      elevationGainM: activity.elevationGainM,
      matchReason: decision?.reason || null
    });

    const record = await prisma.$transaction(async (tx) => {
      if (matchedPlanActivityId) {
        await tx.externalActivity.updateMany({
          where: {
            userId: args.userId,
            provider: 'STRAVA',
            matchedPlanActivityId,
            id: { not: activity.id }
          },
          data: { matchedPlanActivityId: null }
        });
      }
      return tx.externalActivity.update({
        where: { id: activity.id },
        data: {
          matchedPlanActivity: matchedPlanActivityId
            ? { connect: { id: matchedPlanActivityId } }
            : { disconnect: true },
          equivalence: equivalence.equivalence,
          equivalenceNote: equivalence.equivalenceNote,
          equivalenceConfidence: equivalence.equivalenceConfidence,
          loadRatio: equivalence.loadRatio
        }
      });
    });

    if (record.matchedPlanActivityId) {
      matched += 1;
      if (shouldAutoApplyActuals(record.equivalence, record.equivalenceOverride, record.equivalenceConfidence)) {
        const sessionMemberIds = decision?.sessionMemberIds;
        if (sessionMemberIds && sessionMemberIds.length > 0) {
          // Session match: distribute actuals proportionally across all session members
          const allMemberIds = [record.matchedPlanActivityId, ...sessionMemberIds];
          const allMembers = allMemberIds
            .map((id) => plannedCandidates.byId.get(id))
            .filter((m): m is PlannedActivityCandidate => m != null);
          const sessionUpdated = await applyMatchedExternalToSession({
            planMembers: allMembers,
            externalDistanceM: distanceM,
            externalMovingTimeSec: activity.movingTimeSec || activity.durationSec || null,
            startTime: activity.startTime,
            sourceDateKey: getExternalActivityDateKey(activity),
            userUnits: user?.units ?? null
          });
          workoutsUpdated += sessionUpdated;
        } else {
          const updated = await applyMatchedExternalToWorkout({
            planActivityId: record.matchedPlanActivityId,
            startTime: activity.startTime,
            sourceDateKey: getExternalActivityDateKey(activity),
            distanceM,
            durationSec,
            avgHeartRate: activity.avgHeartRate,
            calories: activity.calories,
            userUnits: user?.units ?? null,
            sourceLabel: 'Strava'
          });
          if (updated) workoutsUpdated += 1;
        }
      }
    }

    decisions.push({
      externalActivityId: activity.id,
      externalName: activity.name || null,
      sportType: activity.sportType || null,
      planActivityId: record.matchedPlanActivityId,
      planActivityTitle: matchedCandidate?.title || null,
      equivalence: record.equivalence,
      equivalenceOverride: record.equivalenceOverride,
      loadRatio: record.loadRatio ?? null,
      equivalenceConfidence: record.equivalenceConfidence ?? null,
      equivalenceNote: record.equivalenceNote ?? null
    });
  }

  // If this is a pure rest day (all planned activities are REST type) and the athlete
  // has at least one Strava activity for the day, auto-mark the day as done.
  let restDayAutoCompleted = false;
  const isRestDay =
    dayCandidates.length > 0 && dayCandidates.every((c) => c.type === 'REST');
  if (isRestDay && dayExternal.length > 0) {
    // Find the PlanDay record for this date so we can update its status.
    const planDay = await prisma.planDay.findFirst({
      where: {
        plan: { athleteId: args.userId },
        activities: { some: { id: { in: dayCandidates.map((c) => c.id) } } }
      },
      select: { id: true, notes: true }
    });
    if (planDay) {
      const nextNotes = setDayStatus(planDay.notes, 'DONE');
      await prisma.planDay.update({
        where: { id: planDay.id },
        data: { notes: nextNotes }
      });
      restDayAutoCompleted = true;
    }
  }

  return {
    date,
    stravaActivities: dayExternal.length,
    matched,
    workoutsUpdated,
    unmatched: Math.max(0, dayExternal.length - matched),
    decisions,
    restDayAutoCompleted
  };
}
