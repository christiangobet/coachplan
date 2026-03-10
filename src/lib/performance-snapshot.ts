import { IntegrationProvider } from '@prisma/client';
import { projectTimeWithRiegel } from '@/lib/pace-estimation';
import { prisma } from '@/lib/prisma';

type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';

type SnapshotEstimate = {
  distanceKm: number;
  timeSec: number;
};

type ReadyPerformanceSnapshot = {
  version: 1;
  status: 'READY';
  source: 'STRAVA';
  computedAt: string;
  basedOnLastSyncAt: string | null;
  windowDays: number;
  confidence: {
    score: number;
    label: ConfidenceLabel;
  };
  estimates: {
    fiveK: SnapshotEstimate;
    tenK: SnapshotEstimate;
    halfMarathon: SnapshotEstimate;
    marathon: SnapshotEstimate;
  };
  evidenceSummary: {
    basis: string;
    evidenceCount: number;
    raceLikeCount: number;
    sustainedCount: number;
    workoutCount: number;
    newestEvidenceDate: string | null;
    oldestEvidenceDate: string | null;
    evidenceRuns: Array<{ dateISO: string; level: 'RACE_LIKE' | 'SUSTAINED' | 'STRUCTURED'; distanceKm: number }>;
  };
};

type InsufficientPerformanceSnapshot = {
  version: 1;
  status: 'INSUFFICIENT_DATA';
  source: 'STRAVA';
  computedAt: string;
  basedOnLastSyncAt: string | null;
  reason: string;
};

export type ProfilePerformanceSnapshot = ReadyPerformanceSnapshot | InsufficientPerformanceSnapshot;

export type PerformanceSnapshotResult =
  | { status: 'READY'; snapshot: ReadyPerformanceSnapshot; cached: boolean }
  | { status: 'INSUFFICIENT_DATA'; reason: string; cached: boolean }
  | { status: 'DISCONNECTED'; reason: string }
  | { status: 'NEEDS_SYNC'; dataAvailableDays: number; requestedDays: number };

type CandidateEvidence = {
  id: string;
  level: 'RACE_LIKE' | 'SUSTAINED' | 'STRUCTURED';
  label: string;
  dateISO: string;
  distanceKm: number;
  timeSec: number;
  paceSecPerKm: number;
  pauseRatio: number | null;
  elevationPerKm: number | null;
  baseWeight: number;
};

const TARGETS = {
  fiveK: 5,
  tenK: 10,
  halfMarathon: 21.0975,
  marathon: 42.195
} as const;

const RACE_DISTANCE_ANCHORS = [5, 10, 21.0975, 42.195];
const MIN_DISTANCE_KM = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSportType(value: string | null | undefined) {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function isRoadRunLike(sportType: string | null | undefined) {
  const normalized = normalizeSportType(sportType);
  if (!normalized) return false;
  if (normalized.includes('TRAIL') || normalized.includes('HIKE') || normalized.includes('WALK')) return false;
  return normalized === 'RUN' || normalized === 'VIRTUALRUN' || normalized === 'TREADMILL' || normalized === 'TREADMILLRUN';
}

function recencyWeight(date: Date) {
  const ageDays = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= 21) return 1;
  if (ageDays <= 42) return 0.95;
  if (ageDays <= 84) return 0.9;
  if (ageDays <= 180) return 0.8;
  return 0.7;
}

function pausePenalty(pauseRatio: number | null) {
  if (!pauseRatio || pauseRatio <= 1.06) return 1;
  return clamp(1 - (pauseRatio - 1.06) * 1.25, 0.64, 1);
}

function elevationPenalty(elevationPerKm: number | null) {
  if (!elevationPerKm || elevationPerKm <= 20) return 1;
  return clamp(1 - (elevationPerKm - 20) / 220, 0.72, 1);
}

function isRaceLikeName(name: string | null | undefined) {
  const text = String(name || '').toLowerCase();
  return /\b(race|marathon|half|halb|10k|5k|event|challenge|cup|finish)\b/.test(text);
}

function isStructuredWorkoutName(name: string | null | undefined) {
  const text = String(name || '').toLowerCase();
  return /\b(interval|tempo|threshold|fartlek|repeats?|track|vo2|max|hill)\b/.test(text);
}

function isNearRaceDistance(distanceKm: number) {
  return RACE_DISTANCE_ANCHORS.some((anchor) => Math.abs(distanceKm - anchor) / anchor <= 0.11);
}

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function weightedMean(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function formatDate(value: Date) {
  return value.toISOString();
}

function parseCachedSnapshot(raw: unknown): ProfilePerformanceSnapshot | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  const status = raw.status;
  if (status !== 'READY' && status !== 'INSUFFICIENT_DATA') return null;
  return raw as ProfilePerformanceSnapshot;
}

async function computeSnapshot(args: {
  userId: string;
  lastSyncAt: Date | null;
  lookbackDays: number;
}): Promise<
  | { status: 'READY'; snapshot: ReadyPerformanceSnapshot }
  | { status: 'INSUFFICIENT_DATA'; snapshot: InsufficientPerformanceSnapshot }
> {
  const since = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000);
  const activities = await prisma.externalActivity.findMany({
    where: {
      userId: args.userId,
      provider: IntegrationProvider.STRAVA,
      startTime: { gte: since },
      distanceM: { not: null },
      OR: [
        { movingTimeSec: { not: null } },
        { durationSec: { not: null } }
      ]
    },
    select: {
      id: true,
      name: true,
      sportType: true,
      startTime: true,
      distanceM: true,
      movingTimeSec: true,
      durationSec: true,
      elapsedTimeSec: true,
      elevationGainM: true
    },
    orderBy: { startTime: 'desc' },
    take: 3000
  });

  const runLike = activities
    .filter((activity) => isRoadRunLike(activity.sportType))
    .map((activity) => {
      const distanceKm = (activity.distanceM || 0) / 1000;
      const timeSec = activity.movingTimeSec || activity.durationSec || 0;
      const paceSecPerKm = distanceKm > 0 ? timeSec / distanceKm : Number.POSITIVE_INFINITY;
      const pauseRatio = activity.elapsedTimeSec && activity.movingTimeSec
        ? activity.elapsedTimeSec / activity.movingTimeSec
        : null;
      const elevationPerKm = activity.elevationGainM && distanceKm > 0
        ? activity.elevationGainM / distanceKm
        : null;
      return {
        ...activity,
        distanceKm,
        timeSec,
        paceSecPerKm,
        pauseRatio,
        elevationPerKm
      };
    })
    .filter((activity) => Number.isFinite(activity.distanceKm) && activity.distanceKm >= MIN_DISTANCE_KM)
    .filter((activity) => Number.isFinite(activity.timeSec) && activity.timeSec >= 10 * 60);

  if (runLike.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      snapshot: {
        version: 1,
        status: 'INSUFFICIENT_DATA',
        source: 'STRAVA',
        computedAt: new Date().toISOString(),
        basedOnLastSyncAt: args.lastSyncAt ? args.lastSyncAt.toISOString() : null,
        reason: 'No eligible recent run activities found.'
      }
    };
  }

  const sourceRuns = runLike;
  const selectedWindowDays = args.lookbackDays;

  const raceLike = sourceRuns
    .filter((activity) => isRaceLikeName(activity.name) || isNearRaceDistance(activity.distanceKm))
    .sort((a, b) => a.paceSecPerKm - b.paceSecPerKm)
    .slice(0, 2);

  const structured = sourceRuns
    .filter((activity) => !raceLike.some((race) => race.id === activity.id))
    .filter((activity) => isStructuredWorkoutName(activity.name))
    .sort((a, b) => a.paceSecPerKm - b.paceSecPerKm)
    .slice(0, 1);

  const sustained = sourceRuns
    .filter((activity) => !raceLike.some((race) => race.id === activity.id))
    .filter((activity) => !structured.some((item) => item.id === activity.id))
    .filter((activity) => activity.distanceKm >= 5.5)
    .sort((a, b) => a.paceSecPerKm - b.paceSecPerKm)
    .slice(0, 3);

  const evidence: CandidateEvidence[] = [
    ...raceLike.map((activity) => ({
      id: activity.id,
      level: 'RACE_LIKE' as const,
      label: activity.name || 'Race-like run',
      dateISO: formatDate(activity.startTime),
      distanceKm: activity.distanceKm,
      timeSec: activity.timeSec,
      paceSecPerKm: activity.paceSecPerKm,
      pauseRatio: activity.pauseRatio,
      elevationPerKm: activity.elevationPerKm,
      baseWeight: 1
    })),
    ...sustained.map((activity) => ({
      id: activity.id,
      level: 'SUSTAINED' as const,
      label: activity.name || 'Sustained effort',
      dateISO: formatDate(activity.startTime),
      distanceKm: activity.distanceKm,
      timeSec: activity.timeSec,
      paceSecPerKm: activity.paceSecPerKm,
      pauseRatio: activity.pauseRatio,
      elevationPerKm: activity.elevationPerKm,
      baseWeight: 0.78
    })),
    ...structured.map((activity) => ({
      id: activity.id,
      level: 'STRUCTURED' as const,
      label: activity.name || 'Structured workout',
      dateISO: formatDate(activity.startTime),
      distanceKm: activity.distanceKm,
      timeSec: activity.timeSec,
      paceSecPerKm: activity.paceSecPerKm,
      pauseRatio: activity.pauseRatio,
      elevationPerKm: activity.elevationPerKm,
      baseWeight: 0.56
    }))
  ];

  const hasRaceEvidence = evidence.some((item) => item.level === 'RACE_LIKE');
  if (evidence.length < 2 && !hasRaceEvidence) {
    return {
      status: 'INSUFFICIENT_DATA',
      snapshot: {
        version: 1,
        status: 'INSUFFICIENT_DATA',
        source: 'STRAVA',
        computedAt: new Date().toISOString(),
        basedOnLastSyncAt: args.lastSyncAt ? args.lastSyncAt.toISOString() : null,
        reason: 'Not enough strong run evidence yet. Sync more recent runs.'
      }
    };
  }

  const projectTarget = (targetDistanceKm: number) => {
    const projected = evidence.map((item) => {
      const value = projectTimeWithRiegel({
        sourceDistanceKm: item.distanceKm,
        sourceTimeSec: item.timeSec,
        targetDistanceKm
      });
      const distanceRatio = targetDistanceKm / item.distanceKm;
      const relevance = clamp(1 - Math.abs(Math.log(distanceRatio)) / 2.2, 0.4, 1);
      const date = new Date(item.dateISO);
      const weight = item.baseWeight
        * recencyWeight(date)
        * relevance
        * pausePenalty(item.pauseRatio)
        * elevationPenalty(item.elevationPerKm);
      return { value, weight };
    });

    const med = median(projected.map((item) => item.value));
    const filtered = projected.filter((item) => {
      const ratio = Math.abs(item.value - med) / Math.max(1, med);
      return ratio <= 0.35;
    });
    const kept = filtered.length >= 2 ? filtered : projected;
    const mean = weightedMean(kept);
    if (!mean) return null;
    return Math.round(mean);
  };

  const fiveKSec = projectTarget(TARGETS.fiveK);
  const tenKSec = projectTarget(TARGETS.tenK);
  const halfSec = projectTarget(TARGETS.halfMarathon);
  const fullSec = projectTarget(TARGETS.marathon);

  if (!fiveKSec || !tenKSec || !halfSec || !fullSec) {
    return {
      status: 'INSUFFICIENT_DATA',
      snapshot: {
        version: 1,
        status: 'INSUFFICIENT_DATA',
        source: 'STRAVA',
        computedAt: new Date().toISOString(),
        basedOnLastSyncAt: args.lastSyncAt ? args.lastSyncAt.toISOString() : null,
        reason: 'Not enough valid evidence to produce stable projections.'
      }
    };
  }

  const newestEvidence = evidence[0] ? new Date(evidence[0].dateISO) : null;
  const oldestEvidence = evidence.length > 0 ? new Date(evidence[evidence.length - 1].dateISO) : null;
  const raceLikeCount = evidence.filter((item) => item.level === 'RACE_LIKE').length;
  const sustainedCount = evidence.filter((item) => item.level === 'SUSTAINED').length;
  const workoutCount = evidence.filter((item) => item.level === 'STRUCTURED').length;

  const projectedHalf = evidence.map((item) => projectTimeWithRiegel({
    sourceDistanceKm: item.distanceKm,
    sourceTimeSec: item.timeSec,
    targetDistanceKm: TARGETS.halfMarathon
  }));
  const halfSpread = Math.max(...projectedHalf) - Math.min(...projectedHalf);
  const halfSpreadRatio = halfSec > 0 ? halfSpread / halfSec : 0;
  const meanPauseRatio = evidence.reduce((sum, item) => sum + (item.pauseRatio || 1), 0) / evidence.length;
  const meanElevation = evidence.reduce((sum, item) => sum + (item.elevationPerKm || 0), 0) / evidence.length;
  const newestAgeDays = newestEvidence ? (Date.now() - newestEvidence.getTime()) / (1000 * 60 * 60 * 24) : 999;

  let score = 35;
  score += raceLikeCount > 0 ? 25 : 0;
  score += raceLikeCount > 1 ? 10 : 0;
  score += Math.min(20, evidence.length * 5);
  score += newestAgeDays <= 14 ? 10 : newestAgeDays <= 42 ? 7 : newestAgeDays <= 84 ? 4 : 2;
  score -= clamp((halfSpreadRatio - 0.08) * 100, 0, 18);
  score -= clamp((meanPauseRatio - 1.08) * 30, 0, 8);
  score -= clamp((meanElevation - 28) / 5, 0, 8);
  score = Math.round(clamp(score, 18, 97));

  const windowLabel = selectedWindowDays <= 28 ? '4 weeks'
    : selectedWindowDays <= 56 ? '8 weeks'
    : selectedWindowDays <= 84 ? '12 weeks'
    : selectedWindowDays <= 180 ? '6 months'
    : '12 months';

  const basis = raceLikeCount > 0
    ? `Based on ${raceLikeCount} race-like run${raceLikeCount > 1 ? 's' : ''} and ${Math.max(0, evidence.length - raceLikeCount)} recent effort${Math.max(0, evidence.length - raceLikeCount) === 1 ? '' : 's'} from your last ${windowLabel}.`
    : `Based on ${sustainedCount} sustained effort${sustainedCount === 1 ? '' : 's'}${workoutCount > 0 ? ` and ${workoutCount} structured workout${workoutCount === 1 ? '' : 's'}` : ''} from your last ${windowLabel}.`;

  return {
    status: 'READY',
    snapshot: {
      version: 1,
      status: 'READY',
      source: 'STRAVA',
      computedAt: new Date().toISOString(),
      basedOnLastSyncAt: args.lastSyncAt ? args.lastSyncAt.toISOString() : null,
      windowDays: selectedWindowDays,
      confidence: {
        score,
        label: confidenceLabel(score)
      },
      estimates: {
        fiveK: { distanceKm: TARGETS.fiveK, timeSec: fiveKSec },
        tenK: { distanceKm: TARGETS.tenK, timeSec: tenKSec },
        halfMarathon: { distanceKm: TARGETS.halfMarathon, timeSec: halfSec },
        marathon: { distanceKm: TARGETS.marathon, timeSec: fullSec }
      },
      evidenceSummary: {
        basis,
        evidenceCount: evidence.length,
        raceLikeCount,
        sustainedCount,
        workoutCount,
        newestEvidenceDate: newestEvidence ? newestEvidence.toISOString() : null,
        oldestEvidenceDate: oldestEvidence ? oldestEvidence.toISOString() : null,
        evidenceRuns: evidence.map((item) => ({
          dateISO: item.dateISO,
          level: item.level,
          distanceKm: Math.round(item.distanceKm * 10) / 10
        }))
      }
    }
  };
}

export async function getOrRefreshPerformanceSnapshotForUser(args: {
  userId: string;
  forceRefresh?: boolean;
  lookbackDays?: number;
}): Promise<PerformanceSnapshotResult> {
  const [user, account] = await Promise.all([
    prisma.user.findUnique({
      where: { id: args.userId },
      select: {
        id: true,
        performanceSnapshot: true
      }
    }),
    prisma.externalAccount.findUnique({
      where: {
        userId_provider: {
          userId: args.userId,
          provider: IntegrationProvider.STRAVA
        }
      },
      select: {
        isActive: true,
        lastSyncAt: true
      }
    })
  ]);

  if (!user) return { status: 'DISCONNECTED', reason: 'User not found' };
  if (!account?.isActive) return { status: 'DISCONNECTED', reason: 'Strava is not connected.' };

  const requestedDays = args.lookbackDays ?? 84;

  // Check if DB has enough data for the requested window
  const oldestActivity = await prisma.externalActivity.findFirst({
    where: { userId: args.userId, provider: IntegrationProvider.STRAVA },
    orderBy: { startTime: 'asc' },
    select: { startTime: true }
  });

  if (!oldestActivity) {
    return { status: 'NEEDS_SYNC', dataAvailableDays: 0, requestedDays };
  }
  const dataAvailableDays = (Date.now() - oldestActivity.startTime.getTime()) / (1000 * 60 * 60 * 24);
  if (dataAvailableDays < requestedDays * 0.8) {
    return { status: 'NEEDS_SYNC', dataAvailableDays: Math.floor(dataAvailableDays), requestedDays };
  }

  const cached = parseCachedSnapshot(user.performanceSnapshot);
  const currentSyncIso = account.lastSyncAt ? account.lastSyncAt.toISOString() : null;
  const cachedSyncIso = cached?.basedOnLastSyncAt || null;
  const cachedWindowDays = cached?.status === 'READY' ? (cached as ReadyPerformanceSnapshot).windowDays : null;
  if (!args.forceRefresh && cached && cachedSyncIso === currentSyncIso && cachedWindowDays === requestedDays) {
    if (cached.status === 'READY') {
      return { status: 'READY', snapshot: cached, cached: true };
    }
    return { status: 'INSUFFICIENT_DATA', reason: cached.reason, cached: true };
  }

  const computed = await computeSnapshot({
    userId: args.userId,
    lastSyncAt: account.lastSyncAt,
    lookbackDays: requestedDays
  });

  await prisma.user.update({
    where: { id: args.userId },
    data: {
      performanceSnapshot: computed.snapshot as unknown as object
    }
  });

  if (computed.status === 'READY') {
    return { status: 'READY', snapshot: computed.snapshot, cached: false };
  }
  return { status: 'INSUFFICIENT_DATA', reason: computed.snapshot.reason, cached: false };
}

export async function refreshPerformanceSnapshotForUser(userId: string) {
  return getOrRefreshPerformanceSnapshotForUser({
    userId,
    forceRefresh: true
  });
}
