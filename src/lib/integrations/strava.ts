import { ActivityType, ExternalAccount, Units } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { createIntegrationStateToken } from '@/lib/integrations/state';
import { isDayClosed } from '@/lib/day-status';
import { pickSelectedPlan } from '@/lib/plan-selection';

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
};

type PlannedActivityCandidate = {
  id: string;
  dateKey: string;
  type: ActivityType;
  distanceM: number | null;
  durationSec: number | null;
  completed: boolean;
  actualDistance: number | null;
  actualDuration: number | null;
  actualPace: string | null;
  completedAt: Date | null;
  notes: string | null;
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

type DateMatchBucket = {
  candidates: PlannedActivityCandidate[];
  dayPenalty: number;
};

type PlanActivityCandidates = {
  byDate: Map<string, PlannedActivityCandidate[]>;
  byId: Map<string, PlannedActivityCandidate>;
  planId: string | null;
  lockedDateSet: Set<string>;
};

export type StravaDayImportSummary = {
  date: string;
  stravaActivities: number;
  matched: number;
  workoutsUpdated: number;
  unmatched: number;
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
  preferredPlanId?: string | null
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
        const distanceM = activity.distance
          ? activity.distance * (activity.distanceUnit === 'KM' ? 1000 : 1609.344)
          : null;
        const durationSec = activity.duration ? activity.duration * 60 : null;
        row.push({
          id: activity.id,
          dateKey: key,
          type: activity.type,
          distanceM,
          durationSec,
          completed: activity.completed,
          actualDistance: activity.actualDistance,
          actualDuration: activity.actualDuration,
          actualPace: activity.actualPace,
          completedAt: activity.completedAt,
          notes: activity.notes
        });
        byId.set(activity.id, row[row.length - 1]);
      }

      row.sort((a, b) => Number(a.completed) - Number(b.completed));
      map.set(key, row);
    }
  }

  return { byDate: map, byId, planId: plan.id, lockedDateSet };
}

function pickBestPlannedActivityFromBuckets(
  buckets: DateMatchBucket[],
  actualType: ActivityType,
  durationSec: number | null,
  distanceM: number | null,
  usedPlanActivityIds: Set<string>,
  minScore = 35
) {
  let best: PlannedActivityCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const bucket of buckets) {
    for (const candidate of bucket.candidates) {
      if (usedPlanActivityIds.has(candidate.id)) continue;

      const typeScore = typeCompatibilityScore(candidate.type, actualType);
      if (typeScore < 0) continue;

      let score = typeScore - bucket.dayPenalty;
      if (candidate.completed) score -= 12;

      if (durationSec && candidate.durationSec) {
        const durationDeltaMin = Math.abs(durationSec - candidate.durationSec) / 60;
        score -= Math.min(durationDeltaMin, 40) * 0.8;
      }

      if (distanceM && candidate.distanceM) {
        const distanceDeltaKm = Math.abs(distanceM - candidate.distanceM) / 1000;
        score -= Math.min(distanceDeltaKm, 30) * 2;
      }

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  if (bestScore < minScore) return null;
  return best;
}

function buildDateBuckets(
  byDate: Map<string, PlannedActivityCandidate[]>,
  primaryDateKey: string | null
): DateMatchBucket[] {
  if (!primaryDateKey) return [];
  const buckets: DateMatchBucket[] = [];
  const sameDay = byDate.get(primaryDateKey) || [];
  if (sameDay.length) buckets.push({ candidates: sameDay, dayPenalty: 0 });
  return buckets;
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

  const storageUnit: Units = workout.distanceUnit === 'KM' ? 'KM' : 'MILES';
  const distanceInStorageUnits = args.distanceM ? convertMetersToUserUnits(args.distanceM, storageUnit) : null;
  const paceInStorageUnits = formatPace(args.durationSec, args.distanceM, storageUnit);

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
    data: {
      completed: true,
      completedAt: args.startTime,
      actualDistance: distanceInStorageUnits ?? workout.actualDistance ?? undefined,
      actualDuration: durationMinutes ?? workout.actualDuration ?? undefined,
      actualPace: paceInStorageUnits ?? workout.actualPace ?? undefined,
      notes: nextNotes
    }
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
  if (!account) {
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

  const [fetchedActivities, existingMatches, plannedCandidates] = await Promise.all([
    fetchStravaActivities(accessToken, afterEpoch),
    prisma.externalActivity.findMany({
      where: {
        userId: args.userId,
        provider: 'STRAVA',
        matchedPlanActivityId: { not: null }
      },
      select: { matchedPlanActivityId: true }
    }),
    buildPlanActivityCandidates(args.userId, args.preferredPlanId)
  ]);
  const activities = fetchedActivities.activities;

  const usedPlanActivityIds = new Set(
    existingMatches
      .map((row) => row.matchedPlanActivityId)
      .filter((value): value is string => typeof value === 'string' && plannedCandidates.byId.has(value))
  );

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
    const actualType = mapStravaSportTypeToPlanType(activity.sport_type);

    const existing = await prisma.externalActivity.findUnique({
      where: {
        provider_providerActivityId: {
          provider: 'STRAVA',
          providerActivityId
        }
      },
      select: { id: true, matchedPlanActivityId: true }
    });

    const existingMatchedCandidate = existing?.matchedPlanActivityId
      ? plannedCandidates.byId.get(existing.matchedPlanActivityId) ?? null
      : null;
    const canReuseExistingMatch = Boolean(
      existingMatchedCandidate && dateKey && existingMatchedCandidate.dateKey === dateKey
    );

    const dateBuckets = buildDateBuckets(plannedCandidates.byDate, dateKey);
    const matchedCandidate = canReuseExistingMatch
      ? existingMatchedCandidate
      : pickBestPlannedActivityFromBuckets(
          dateBuckets,
          actualType,
          durationSec,
          distanceM,
          usedPlanActivityIds
        );

    const matchedPlanActivityId = matchedCandidate?.id || null;
    if (matchedPlanActivityId) usedPlanActivityIds.add(matchedPlanActivityId);

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
        avgPaceSecPerKm: durationSec && distanceM && distanceM > 0
          ? durationSec / (distanceM / 1000)
          : null,
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
        avgPaceSecPerKm: durationSec && distanceM && distanceM > 0
          ? durationSec / (distanceM / 1000)
          : null,
        raw: activity as unknown as object,
        matchedPlanActivityId
      }
    });
    imported += 1;

    if (record.matchedPlanActivityId) {
      matched += 1;
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
      calories: true
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
        matchedPlanActivityId: args.planActivityId
      }
    });
  });

  if (args.planActivityId && args.applyActuals !== false) {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { units: true }
    });
    await applyMatchedExternalToWorkout({
      planActivityId: args.planActivityId,
      startTime: external.startTime,
      distanceM: external.distanceM,
      durationSec: external.durationSec,
      avgHeartRate: external.avgHeartRate,
      calories: external.calories,
      userUnits: user?.units ?? null,
      sourceLabel: 'Strava'
    });
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

  const plannedCandidates = await buildPlanActivityCandidates(args.userId, args.preferredPlanId);
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

  let matched = 0;
  let workoutsUpdated = 0;
  for (const activity of dayExternal) {
    const durationSec = activity.durationSec || activity.movingTimeSec || activity.elapsedTimeSec || null;
    const distanceM = activity.distanceM || null;
    const actualType = mapStravaSportTypeToPlanType(activity.sportType);

    const hasValidExistingMatch = Boolean(
      activity.matchedPlanActivityId && dayCandidateIds.has(activity.matchedPlanActivityId)
    );
    let matchedPlanActivityId =
      hasValidExistingMatch && activity.matchedPlanActivityId && !usedPlanActivityIds.has(activity.matchedPlanActivityId)
        ? activity.matchedPlanActivityId
        : null;

    if (!matchedPlanActivityId) {
      const matchedCandidate = pickBestPlannedActivityFromBuckets(
        [{ candidates: dayCandidates, dayPenalty: 0 }],
        actualType,
        durationSec,
        distanceM,
        usedPlanActivityIds
      );
      matchedPlanActivityId = matchedCandidate?.id || null;
    }

    if (!matchedPlanActivityId) {
      const remainingNonRest = dayCandidates.filter(
        (candidate) => !usedPlanActivityIds.has(candidate.id) && candidate.type !== 'REST'
      );
      if (remainingNonRest.length === 1) {
        matchedPlanActivityId = remainingNonRest[0].id;
      } else if (totalDayExternal === 1 && remainingNonRest.length > 0) {
        const fallbackCandidate = pickBestPlannedActivityFromBuckets(
          [{ candidates: remainingNonRest, dayPenalty: 0 }],
          actualType,
          durationSec,
          distanceM,
          usedPlanActivityIds,
          Number.NEGATIVE_INFINITY
        );
        matchedPlanActivityId = fallbackCandidate?.id || null;
      }
    }

    if (matchedPlanActivityId) {
      usedPlanActivityIds.add(matchedPlanActivityId);
    }

    await prisma.$transaction(async (tx) => {
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
      await tx.externalActivity.update({
        where: { id: activity.id },
        data: { matchedPlanActivityId: matchedPlanActivityId || null }
      });
    });

    if (matchedPlanActivityId) {
      matched += 1;
      const updated = await applyMatchedExternalToWorkout({
        planActivityId: matchedPlanActivityId,
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

  return {
    date,
    stravaActivities: dayExternal.length,
    matched,
    workoutsUpdated,
    unmatched: Math.max(0, dayExternal.length - matched)
  };
}
