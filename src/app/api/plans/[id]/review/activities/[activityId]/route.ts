import { ActivityType, Units } from '@prisma/client';
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId, activityId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

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

  const raw = body as {
    title?: unknown;
    type?: unknown;
    subtype?: unknown;
    rawText?: unknown;
    distance?: unknown;
    duration?: unknown;
    distanceUnit?: unknown;
    paceTarget?: unknown;
    effortTarget?: unknown;
    notes?: unknown;
  };

  const updates: {
    title?: string;
    type?: ActivityType;
    subtype?: string | null;
    rawText?: string | null;
    distance?: number | null;
    duration?: number | null;
    distanceUnit?: Units | null;
    paceTarget?: string | null;
    effortTarget?: string | null;
    notes?: string | null;
  } = {};

  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string' || !raw.title.trim()) {
      return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 });
    }
    updates.title = raw.title.trim();
  }

  if (raw.type !== undefined) {
    if (typeof raw.type !== 'string' || !ACTIVITY_TYPES.includes(raw.type as ActivityType)) {
      return NextResponse.json({ error: 'Invalid activity type' }, { status: 400 });
    }
    updates.type = raw.type as ActivityType;
  }

  if (raw.distanceUnit !== undefined) {
    if (raw.distanceUnit === null || raw.distanceUnit === '') {
      updates.distanceUnit = null;
    } else if (
      typeof raw.distanceUnit === 'string'
      && DISTANCE_UNITS.includes(raw.distanceUnit as Units)
    ) {
      updates.distanceUnit = raw.distanceUnit as Units;
    } else {
      return NextResponse.json({ error: 'Invalid distance unit' }, { status: 400 });
    }
  }

  const distance = normalizeOptionalNumber(raw.distance);
  if (distance !== undefined) {
    if (distance !== null && distance < 0) {
      return NextResponse.json({ error: 'distance must be >= 0' }, { status: 400 });
    }
    updates.distance = distance;
  }

  const duration = normalizeOptionalNumber(raw.duration);
  if (duration !== undefined) {
    if (duration !== null && (!Number.isInteger(duration) || duration < 0)) {
      return NextResponse.json({ error: 'duration must be a non-negative integer' }, { status: 400 });
    }
    updates.duration = duration;
  }

  const subtype = normalizeOptionalText(raw.subtype);
  if (subtype !== undefined) updates.subtype = subtype;

  const rawText = normalizeOptionalText(raw.rawText);
  if (rawText !== undefined) updates.rawText = rawText;

  const paceTarget = normalizeOptionalText(raw.paceTarget);
  if (paceTarget !== undefined) updates.paceTarget = paceTarget;

  const effortTarget = normalizeOptionalText(raw.effortTarget);
  if (effortTarget !== undefined) updates.effortTarget = effortTarget;

  const notes = normalizeOptionalText(raw.notes);
  if (notes !== undefined) updates.notes = notes;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const activity = await prisma.planActivity.findFirst({
    where: { id: activityId, planId },
    select: { id: true }
  });
  if (!activity) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });

  const updated = await prisma.planActivity.update({
    where: { id: activityId },
    data: updates
  });

  return NextResponse.json({ activity: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId, activityId } = await params;
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

  const activity = await prisma.planActivity.findFirst({
    where: { id: activityId, planId },
    select: { id: true }
  });
  if (!activity) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });

  await prisma.planActivity.delete({ where: { id: activityId } });
  return NextResponse.json({ deleted: true, activityId });
}
