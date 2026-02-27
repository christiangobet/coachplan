import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { PlanStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';

function parseRaceDateInput(input: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (input === null || input === '') {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false };
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

async function appendSourcePlanName<T extends { sourceId?: string | null }>(plan: T) {
  if (!plan.sourceId) {
    return { ...plan, sourcePlanName: null };
  }
  const sourcePlan = await prisma.trainingPlan.findUnique({
    where: { id: plan.sourceId },
    select: { name: true }
  });
  return { ...plan, sourcePlanName: sourcePlan?.name || null };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const viewerUnits = profile?.units === 'KM' ? 'KM' : 'MILES';

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ plan: await appendSourcePlanName(plan), viewerUnits });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const viewerUnits = profile?.units === 'KM' ? 'KM' : 'MILES';

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const existingPlan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      weekCount: true
    }
  });
  if (!existingPlan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existingPlan.ownerId !== user.id && existingPlan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updates: {
    name?: string;
    raceName?: string | null;
    raceDate?: Date | null;
    status?: PlanStatus;
    planGuide?: string | null;
    planSummary?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  } = {};

  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    updates.name = body.name.trim();
  }

  if ('raceName' in body) {
    if (body.raceName !== null && typeof body.raceName !== 'string') {
      return NextResponse.json({ error: 'raceName must be a string or null' }, { status: 400 });
    }
    const raceName = typeof body.raceName === 'string' ? body.raceName.trim() : '';
    updates.raceName = raceName || null;
  }

  let raceDatePatched = false;
  if ('raceDate' in body) {
    const parsedRaceDate = parseRaceDateInput(body.raceDate);
    if (!parsedRaceDate.ok) {
      return NextResponse.json({ error: 'raceDate must be an ISO date string or null' }, { status: 400 });
    }
    raceDatePatched = true;
    updates.raceDate = parsedRaceDate.value;
  }

  if ('status' in body) {
    if (typeof body.status !== 'string' || !['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(body.status)) {
      return NextResponse.json({ error: 'status must be DRAFT, ACTIVE, or ARCHIVED' }, { status: 400 });
    }
    updates.status = body.status as PlanStatus;
  }

  if ('planGuide' in body) {
    if (body.planGuide === null || typeof body.planGuide === 'string') {
      updates.planGuide = typeof body.planGuide === 'string' ? body.planGuide || null : null;
    }
  }

  if ('planSummary' in body) {
    if (body.planSummary === null) {
      updates.planSummary = Prisma.JsonNull;
    } else if (typeof body.planSummary === 'object' && !Array.isArray(body.planSummary)) {
      updates.planSummary = body.planSummary as Prisma.InputJsonValue;
    }
  }

  if (!('name' in body) && !('raceName' in body) && !('raceDate' in body) && !('status' in body) && !('planGuide' in body) && !('planSummary' in body)) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
  }

  const plan = await prisma.trainingPlan.update({
    where: { id },
    data: updates,
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });

  if (raceDatePatched) {
    const totalWeeks = existingPlan.weekCount || plan.weeks.length;
    if (updates.raceDate && totalWeeks > 0) {
      await alignWeeksToRaceDate(plan.id, totalWeeks, updates.raceDate);
    } else {
      await prisma.planWeek.updateMany({
        where: { planId: plan.id },
        data: { startDate: null, endDate: null }
      });
    }
  }

  const refreshed = await prisma.trainingPlan.findUnique({
    where: { id: plan.id },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });

  if (!refreshed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ plan: await appendSourcePlanName(refreshed), viewerUnits });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      isTemplate: true
    }
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (plan.isTemplate && plan.ownerId !== user.id) {
    return NextResponse.json({ error: 'Only the template owner can delete it' }, { status: 403 });
  }

  const planActivityIds = await prisma.planActivity.findMany({
    where: { planId: plan.id },
    select: { id: true }
  });

  await prisma.$transaction(async (tx) => {
    if (planActivityIds.length > 0) {
      await tx.externalActivity.updateMany({
        where: {
          matchedPlanActivityId: {
            in: planActivityIds.map((a) => a.id)
          }
        },
        data: {
          matchedPlanActivityId: null
        }
      });
    }

    await tx.planActivity.deleteMany({ where: { planId: plan.id } });
    await tx.planDay.deleteMany({ where: { planId: plan.id } });
    await tx.planWeek.deleteMany({ where: { planId: plan.id } });
    await tx.trainingPlan.delete({ where: { id: plan.id } });
  });

  return NextResponse.json({ deleted: true, id: plan.id });
}
