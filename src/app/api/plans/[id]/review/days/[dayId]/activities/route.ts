import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ActivityType, Units } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const ACTIVITY_TYPES: ActivityType[] = [
  'RUN',
  'STRENGTH',
  'CROSS_TRAIN',
  'REST',
  'MOBILITY',
  'YOGA',
  'HIKE',
  'OTHER'
];

const DISTANCE_UNITS: Units[] = ['MILES', 'KM'];

function normalizeOptionalText(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  return value || null;
}

function normalizeOptionalNumber(input: unknown): number | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  const value = Number(input);
  if (!Number.isFinite(value)) return undefined;
  return value;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId, dayId } = await params;
  const body = await req.json().catch(() => ({}));

  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: { id: true, ownerId: true, athleteId: true, status: true }
  });

  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (plan.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only draft plans can be edited in review' }, { status: 400 });
  }

  const day = await prisma.planDay.findFirst({
    where: { id: dayId, planId },
    select: { id: true }
  });
  if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 });

  const payload = body as {
    title?: unknown;
    type?: unknown;
    distance?: unknown;
    distanceUnit?: unknown;
    duration?: unknown;
    paceTarget?: unknown;
    effortTarget?: unknown;
    rawText?: unknown;
  };

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'New Workout';

  let type: ActivityType = 'RUN';
  if (payload.type !== undefined) {
    if (typeof payload.type !== 'string' || !ACTIVITY_TYPES.includes(payload.type as ActivityType)) {
      return NextResponse.json({ error: 'Invalid activity type' }, { status: 400 });
    }
    type = payload.type as ActivityType;
  }

  const distance = normalizeOptionalNumber(payload.distance);
  if (distance !== undefined && distance !== null && distance < 0) {
    return NextResponse.json({ error: 'distance must be >= 0' }, { status: 400 });
  }

  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const preferredUnits: Units = profile?.units === 'KM' ? 'KM' : 'MILES';

  let distanceUnit: Units | null | undefined = undefined;
  if (payload.distanceUnit !== undefined) {
    if (payload.distanceUnit === null || payload.distanceUnit === '') {
      distanceUnit = null;
    } else if (typeof payload.distanceUnit === 'string' && DISTANCE_UNITS.includes(payload.distanceUnit as Units)) {
      distanceUnit = payload.distanceUnit as Units;
    } else {
      return NextResponse.json({ error: 'Invalid distance unit' }, { status: 400 });
    }
  }

  const duration = normalizeOptionalNumber(payload.duration);
  if (
    duration !== undefined
    && duration !== null
    && (!Number.isInteger(duration) || duration < 0)
  ) {
    return NextResponse.json({ error: 'duration must be a non-negative integer' }, { status: 400 });
  }

  const activity = await prisma.planActivity.create({
    data: {
      planId,
      dayId,
      title,
      type,
      distance: distance === undefined ? null : distance,
      distanceUnit: distance === undefined || distance === null
        ? null
        : (distanceUnit ?? preferredUnits),
      duration: duration === undefined ? null : duration,
      paceTarget: normalizeOptionalText(payload.paceTarget) ?? null,
      effortTarget: normalizeOptionalText(payload.effortTarget) ?? null,
      rawText: normalizeOptionalText(payload.rawText) ?? null
    }
  });

  return NextResponse.json({ activity });
}
