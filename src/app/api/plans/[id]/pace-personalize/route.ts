import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import {
  buildPaceTargetText,
  classifyRunPaceBucket,
  derivePaceProfileFromRaceTarget
} from '@/lib/pace-personalization';

function normalizeNumber(input: unknown) {
  if (input === null || input === undefined || input === '') return 0;
  const value = Number(input);
  return Number.isFinite(value) ? value : NaN;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const raceDistanceKm = normalizeNumber((body as { raceDistanceKm?: unknown }).raceDistanceKm);
  const hours = normalizeNumber((body as { goalHours?: unknown }).goalHours);
  const minutes = normalizeNumber((body as { goalMinutes?: unknown }).goalMinutes);
  const seconds = normalizeNumber((body as { goalSeconds?: unknown }).goalSeconds);
  const overrideExisting = Boolean((body as { overrideExisting?: unknown }).overrideExisting);
  const saveToProfile = (body as { saveToProfile?: unknown }).saveToProfile !== false;

  if (!Number.isFinite(raceDistanceKm) || raceDistanceKm <= 0) {
    return NextResponse.json({ error: 'raceDistanceKm must be greater than 0' }, { status: 400 });
  }
  if (![hours, minutes, seconds].every((value) => Number.isFinite(value) && value >= 0)) {
    return NextResponse.json({ error: 'Target time is invalid' }, { status: 400 });
  }
  if (minutes >= 60 || seconds >= 60) {
    return NextResponse.json({ error: 'Minutes and seconds must be less than 60' }, { status: 400 });
  }

  const goalTimeSec = Math.round(hours * 3600 + minutes * 60 + seconds);
  if (goalTimeSec < 600) {
    return NextResponse.json({ error: 'Target time must be at least 10 minutes' }, { status: 400 });
  }

  const [dbUser, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, units: true, paceTargets: true }
    }),
    prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        status: true,
        athleteId: true,
        ownerId: true,
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

  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (plan.athleteId !== dbUser.id && plan.ownerId !== dbUser.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (plan.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Plan must be active before pace personalization' }, { status: 400 });
  }

  const unit = dbUser.units === 'KM' ? 'KM' : 'MILES';
  const profile = derivePaceProfileFromRaceTarget({
    raceDistanceKm,
    goalTimeSec,
    unit
  });

  const updates: Array<{ id: string; paceTarget: string }> = [];
  let skippedExisting = 0;
  let runCount = 0;

  for (const activity of plan.activities) {
    if (activity.type !== 'RUN') continue;
    runCount += 1;
    if (!overrideExisting && activity.paceTarget && activity.paceTarget.trim()) {
      skippedExisting += 1;
      continue;
    }

    const bucket = classifyRunPaceBucket(activity);
    const paceTarget = buildPaceTargetText(bucket, profile);
    if (!paceTarget) continue;
    updates.push({ id: activity.id, paceTarget });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((update) =>
        prisma.planActivity.update({
          where: { id: update.id },
          data: { paceTarget: update.paceTarget }
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
    profile
  });
}
