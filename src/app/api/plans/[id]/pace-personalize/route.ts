import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { IntegrationProvider, RaceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  buildPaceTargetText,
  classifyRunPaceBucket,
  derivePaceProfileFromRaceTarget
} from '@/lib/pace-personalization';
import {
  deriveStructuredIntensityTargets,
  inferSymbolicPaceBucketFromText
} from '@/lib/intensity-targets';
import {
  PaceEvidence,
  estimateGoalTimeFromEvidence,
  parseTimePartsToSeconds
} from '@/lib/pace-estimation';

const RACE_DISTANCE_KM_BY_TYPE: Record<RaceType, number> = {
  FIVE_K: 5,
  TEN_K: 10,
  HALF_MARATHON: 21.0975,
  MARATHON: 42.195,
  ULTRA_50K: 50,
  ULTRA_50MI: 80.467,
  ULTRA_100K: 100,
  ULTRA_100MI: 160.934,
  TRAIL: 42.195
};

const COMMON_RACE_DISTANCES = [
  { label: '5K', km: 5 },
  { label: '10K', km: 10 },
  { label: 'Half Marathon', km: 21.0975 },
  { label: 'Marathon', km: 42.195 }
] as const;

type ManualEvidenceInput = {
  label?: unknown;
  distanceKm?: unknown;
  timeSec?: unknown;
  dateISO?: unknown;
};

function normalizeNumber(input: unknown) {
  if (input === null || input === undefined || input === '') return NaN;
  const value = Number(input);
  return Number.isFinite(value) ? value : NaN;
}

function toCommonDistanceLabel(km: number) {
  const match = COMMON_RACE_DISTANCES.find((item) => Math.abs(item.km - km) / item.km <= 0.01);
  return match?.label || `${km.toFixed(1)}K`;
}

function parseManualEvidence(value: unknown): PaceEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: PaceEvidence[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as ManualEvidenceInput;
    const distanceKm = normalizeNumber(input.distanceKm);
    const timeSec = normalizeNumber(input.timeSec);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) continue;
    if (!Number.isFinite(timeSec) || timeSec < 60) continue;
    evidence.push({
      source: 'MANUAL',
      label: typeof input.label === 'string' ? input.label.slice(0, 120) : null,
      distanceKm,
      timeSec,
      dateISO: typeof input.dateISO === 'string' ? input.dateISO : null
    });
  }
  return evidence;
}

async function getAuthorizedPlan(planId: string, userId: string) {
  const [dbUser, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, units: true, paceTargets: true }
    }),
    prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        status: true,
        athleteId: true,
        ownerId: true,
        raceType: true,
        activities: {
          select: {
            id: true,
            type: true,
            subtype: true,
            title: true,
            rawText: true,
            paceTarget: true
          }
        }
      }
    })
  ]);

  if (!dbUser) return { dbUser: null, plan: null, error: NextResponse.json({ error: 'User not found' }, { status: 404 }) };
  if (!plan) return { dbUser, plan: null, error: NextResponse.json({ error: 'Plan not found' }, { status: 404 }) };
  if (plan.athleteId !== dbUser.id && plan.ownerId !== dbUser.id) {
    return { dbUser, plan: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { dbUser, plan, error: null };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId } = await params;
  const auth = await getAuthorizedPlan(planId, user.id);
  if (auth.error || !auth.dbUser || !auth.plan) return auth.error!;

  const raceDistanceKmDefault = auth.plan.raceType
    ? (RACE_DISTANCE_KM_BY_TYPE[auth.plan.raceType] || 42.195)
    : 42.195;

  const stravaAccount = await prisma.externalAccount.findUnique({
    where: {
      userId_provider: {
        userId: user.id,
        provider: IntegrationProvider.STRAVA
      }
    },
    select: {
      isActive: true,
      providerUsername: true,
      lastSyncAt: true
    }
  });

  const candidates: Array<{
    id: string;
    label: string;
    distanceKm: number;
    timeSec: number;
    dateISO: string;
    activityName: string | null;
  }> = [];

  if (stravaAccount?.isActive) {
    const since = new Date();
    since.setDate(since.getDate() - 730);
    const recentRuns = await prisma.externalActivity.findMany({
      where: {
        userId: user.id,
        provider: IntegrationProvider.STRAVA,
        startTime: { gte: since },
        distanceM: { not: null },
        durationSec: { not: null }
      },
      select: {
        id: true,
        sportType: true,
        distanceM: true,
        durationSec: true,
        startTime: true,
        name: true
      },
      orderBy: { startTime: 'desc' },
      take: 2000
    });

    const runLike = recentRuns.filter((activity) => {
      const sportText = `${activity.sportType || ''} ${activity.name || ''}`.toLowerCase();
      return sportText.includes('run');
    });

    for (const distance of COMMON_RACE_DISTANCES) {
      const matches = runLike.filter((activity) => {
        if (!activity.distanceM || !activity.durationSec) return false;
        const distanceKm = activity.distanceM / 1000;
        const ratioDiff = Math.abs(distanceKm - distance.km) / distance.km;
        return ratioDiff <= 0.08;
      });
      if (matches.length === 0) continue;
      const best = matches.reduce((current, next) => (
        (next.durationSec || Number.MAX_SAFE_INTEGER) < (current.durationSec || Number.MAX_SAFE_INTEGER) ? next : current
      ));
      if (!best.distanceM || !best.durationSec) continue;
      candidates.push({
        id: best.id,
        label: `${distance.label} best effort`,
        distanceKm: Number((best.distanceM / 1000).toFixed(3)),
        timeSec: best.durationSec,
        dateISO: best.startTime.toISOString(),
        activityName: best.name || null
      });
    }
  }

  return NextResponse.json({
    raceDistanceKmDefault,
    strava: {
      connected: Boolean(stravaAccount?.isActive),
      providerUsername: stravaAccount?.providerUsername || null,
      lastSyncAt: stravaAccount?.lastSyncAt?.toISOString() || null,
      candidates
    },
    hints: {
      supportedManualDistances: COMMON_RACE_DISTANCES.map((item) => ({
        label: item.label,
        distanceKm: item.km
      }))
    }
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId } = await params;
  const auth = await getAuthorizedPlan(planId, user.id);
  if (auth.error || !auth.dbUser || !auth.plan) return auth.error!;
  const { dbUser, plan } = auth;

  if (plan.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Plan must be active before pace personalization' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const raceDistanceKm = normalizeNumber((body as { raceDistanceKm?: unknown }).raceDistanceKm);
  const overrideExisting = Boolean((body as { overrideExisting?: unknown }).overrideExisting);
  const saveToProfile = (body as { saveToProfile?: unknown }).saveToProfile !== false;
  const age = normalizeNumber((body as { age?: unknown }).age);
  const sexRaw = (body as { sex?: unknown }).sex;
  const sex = typeof sexRaw === 'string' && sexRaw.trim() ? sexRaw.trim().slice(0, 20) : null;

  if (!Number.isFinite(raceDistanceKm) || raceDistanceKm <= 0) {
    return NextResponse.json({ error: 'raceDistanceKm must be greater than 0' }, { status: 400 });
  }

  const explicitGoalTime = normalizeNumber((body as { targetGoalTimeSec?: unknown }).targetGoalTimeSec);
  const timeFromParts = parseTimePartsToSeconds(
    (body as { goalHours?: unknown }).goalHours,
    (body as { goalMinutes?: unknown }).goalMinutes,
    (body as { goalSeconds?: unknown }).goalSeconds
  );

  const manualEvidence = parseManualEvidence((body as { manualEvidence?: unknown }).manualEvidence);
  const allEvidence: PaceEvidence[] = [...manualEvidence];

  const stravaActivityId = (body as { stravaActivityId?: unknown }).stravaActivityId;
  if (typeof stravaActivityId === 'string' && stravaActivityId.trim()) {
    const external = await prisma.externalActivity.findFirst({
      where: {
        id: stravaActivityId,
        userId: user.id,
        provider: IntegrationProvider.STRAVA
      },
      select: {
        id: true,
        name: true,
        startTime: true,
        distanceM: true,
        durationSec: true
      }
    });
    if (external?.distanceM && external?.durationSec) {
      allEvidence.push({
        source: 'STRAVA',
        label: external.name || 'Strava effort',
        distanceKm: external.distanceM / 1000,
        timeSec: external.durationSec,
        dateISO: external.startTime.toISOString()
      });
    }
  }

  let goalTimeSec = Number.isFinite(explicitGoalTime) && explicitGoalTime > 0
    ? Math.round(explicitGoalTime)
    : null;
  if (!goalTimeSec && timeFromParts && timeFromParts > 0) {
    goalTimeSec = timeFromParts;
  }

  let inference: {
    method: 'TARGET_TIME' | 'EVIDENCE_ESTIMATE';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    evidenceUsed: number;
    spreadSec: number | null;
  } = {
    method: 'TARGET_TIME',
    confidence: null,
    evidenceUsed: 0,
    spreadSec: null
  };

  if (!goalTimeSec) {
    const estimate = estimateGoalTimeFromEvidence({
      targetDistanceKm: raceDistanceKm,
      evidence: allEvidence
    });
    if (!estimate) {
      return NextResponse.json({
        error: 'Provide either target race time or at least one valid race/effort result.'
      }, { status: 400 });
    }
    goalTimeSec = estimate.goalTimeSec;
    inference = {
      method: 'EVIDENCE_ESTIMATE',
      confidence: estimate.confidence,
      evidenceUsed: estimate.evidenceUsed,
      spreadSec: estimate.spreadSec
    };
  }

  if (!goalTimeSec || goalTimeSec < 600) {
    return NextResponse.json({ error: 'Target time must be at least 10 minutes' }, { status: 400 });
  }

  const unit = dbUser.units === 'KM' ? 'KM' : 'MILES';
  const profile = derivePaceProfileFromRaceTarget({
    raceDistanceKm,
    goalTimeSec,
    unit
  });

  const updates: Array<{
    id: string;
    paceTarget: string;
    paceTargetMode: 'SYMBOLIC' | 'NUMERIC' | 'RANGE' | 'HYBRID' | 'UNKNOWN' | null;
    paceTargetBucket: 'RECOVERY' | 'EASY' | 'LONG' | 'RACE' | 'TEMPO' | 'THRESHOLD' | 'INTERVAL' | null;
    paceTargetMinSec: number | null;
    paceTargetMaxSec: number | null;
    paceTargetUnit: 'KM' | 'MILES' | null;
  }> = [];
  let skippedExisting = 0;
  let runCount = 0;

  for (const activity of plan.activities) {
    if (activity.type !== 'RUN') continue;
    runCount += 1;
    const existingPaceTarget = activity.paceTarget && activity.paceTarget.trim()
      ? activity.paceTarget.trim()
      : null;
    const symbolicBucket = inferSymbolicPaceBucketFromText(existingPaceTarget);
    if (!overrideExisting && existingPaceTarget && !symbolicBucket) {
      skippedExisting += 1;
      continue;
    }

    const bucket = symbolicBucket || classifyRunPaceBucket(activity);
    const paceTarget = buildPaceTargetText(bucket, profile);
    if (!paceTarget) continue;
    if (existingPaceTarget === paceTarget) continue;
    const structured = deriveStructuredIntensityTargets({
      paceTarget,
      effortTarget: null,
      fallbackUnit: unit
    });
    updates.push({
      id: activity.id,
      paceTarget,
      paceTargetMode: structured.paceTargetMode,
      paceTargetBucket: structured.paceTargetBucket,
      paceTargetMinSec: structured.paceTargetMinSec,
      paceTargetMaxSec: structured.paceTargetMaxSec,
      paceTargetUnit: structured.paceTargetUnit
    });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((update) =>
        prisma.planActivity.update({
          where: { id: update.id },
          data: {
            paceTarget: update.paceTarget,
            paceTargetMode: update.paceTargetMode,
            paceTargetBucket: update.paceTargetBucket,
            paceTargetMinSec: update.paceTargetMinSec,
            paceTargetMaxSec: update.paceTargetMaxSec,
            paceTargetUnit: update.paceTargetUnit
          }
        })
      )
    );
  }

  if (saveToProfile) {
    const existing = dbUser.paceTargets && typeof dbUser.paceTargets === 'object'
      ? (dbUser.paceTargets as Record<string, unknown>)
      : {};

    await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        paceTargets: {
          ...existing,
          easy: profile.easy,
          tempo: profile.tempo,
          long: profile.long,
          race: profile.race,
          threshold: profile.threshold,
          interval: profile.interval,
          recovery: profile.recovery,
          raceGoal: {
            raceDistanceKm,
            goalTimeSec,
            unit,
            method: inference.method,
            confidence: inference.confidence,
            evidenceUsed: inference.evidenceUsed,
            sourceDistances: allEvidence.map((item) => toCommonDistanceLabel(item.distanceKm)),
            age: Number.isFinite(age) && age > 0 ? Math.round(age) : null,
            sex,
            updatedAt: new Date().toISOString()
          }
        }
      }
    });
  }

  return NextResponse.json({
    ok: true,
    summary: {
      runActivities: runCount,
      updated: updates.length,
      skippedExisting
    },
    profile,
    inference: {
      ...inference,
      goalTimeSec
    }
  });
}
