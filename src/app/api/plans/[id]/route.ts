import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { PlanStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { alignWeeksToRaceDate, alignWeeksToStartDate } from '@/lib/clone-plan';

const ACTIVITY_ORDER_BY = [{ sessionOrder: 'asc' as const }, { id: 'asc' as const }];
type WeekDateAnchor = 'RACE_DATE' | 'START_DATE';

function parseDateInput(input: unknown): { ok: true; value: Date | null } | { ok: false } {
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

function parseWeekDateAnchor(input: unknown): WeekDateAnchor | null {
  if (typeof input !== 'string') return null;
  if (input === 'RACE_DATE' || input === 'START_DATE') return input;
  return null;
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
      weeks: {
        orderBy: { weekIndex: 'asc' },
        include: {
          days: {
            orderBy: { dayOfWeek: 'asc' },
            include: {
              activities: {
                orderBy: ACTIVITY_ORDER_BY
              }
            }
          }
        }
      },
      days: {
        orderBy: { dayOfWeek: 'asc' },
        include: {
          activities: {
            orderBy: ACTIVITY_ORDER_BY
          }
        }
      },
      activities: {
        orderBy: [{ dayId: 'asc' as const }, ...ACTIVITY_ORDER_BY]
      }
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
      status: true,
      weekCount: true,
      raceDate: true
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
    isPublic?: boolean;
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
    const parsedRaceDate = parseDateInput(body.raceDate);
    if (!parsedRaceDate.ok) {
      return NextResponse.json({ error: 'raceDate must be an ISO date string or null' }, { status: 400 });
    }
    raceDatePatched = true;
    updates.raceDate = parsedRaceDate.value;
  }

  let startDatePatched = false;
  let startDateValue: Date | null = null;
  if ('startDate' in body) {
    const parsedStartDate = parseDateInput(body.startDate);
    if (!parsedStartDate.ok) {
      return NextResponse.json({ error: 'startDate must be an ISO date string or null' }, { status: 400 });
    }
    startDatePatched = true;
    startDateValue = parsedStartDate.value;
  }

  let weekDateAnchor: WeekDateAnchor | null = null;
  if ('weekDateAnchor' in body) {
    weekDateAnchor = parseWeekDateAnchor(body.weekDateAnchor);
    if (!weekDateAnchor) {
      return NextResponse.json({ error: 'weekDateAnchor must be RACE_DATE or START_DATE' }, { status: 400 });
    }
  }

  if (!weekDateAnchor && startDatePatched && raceDatePatched) {
    return NextResponse.json(
      { error: 'Provide weekDateAnchor when updating both raceDate and startDate' },
      { status: 400 }
    );
  }

  const effectiveRaceDate = raceDatePatched
    ? updates.raceDate ?? null
    : existingPlan.raceDate ?? null;

  if (weekDateAnchor === 'RACE_DATE' && !effectiveRaceDate) {
    return NextResponse.json(
      { error: 'Race date is required when weekDateAnchor is RACE_DATE' },
      { status: 400 }
    );
  }

  if (weekDateAnchor === 'START_DATE' && !startDatePatched) {
    return NextResponse.json(
      { error: 'startDate is required when weekDateAnchor is START_DATE' },
      { status: 400 }
    );
  }
  if (weekDateAnchor === 'START_DATE' && !startDateValue) {
    return NextResponse.json(
      { error: 'startDate must be a valid date when weekDateAnchor is START_DATE' },
      { status: 400 }
    );
  }

  if ('status' in body) {
    if (typeof body.status !== 'string' || !['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(body.status)) {
      return NextResponse.json({ error: 'status must be DRAFT, ACTIVE, or ARCHIVED' }, { status: 400 });
    }
    updates.status = body.status as PlanStatus;
  }

  const nextStatus = updates.status ?? existingPlan.status;
  const isTransitioningToActive = existingPlan.status !== 'ACTIVE' && nextStatus === 'ACTIVE';
  if (nextStatus !== 'ACTIVE' && (startDatePatched || weekDateAnchor !== null)) {
    return NextResponse.json(
      { error: 'Scheduling mode is applied only when a plan is ACTIVE.' },
      { status: 400 }
    );
  }
  if (isTransitioningToActive && !weekDateAnchor && !effectiveRaceDate && !startDateValue) {
    return NextResponse.json(
      { error: 'Activation requires scheduling: provide raceDate or startDate with weekDateAnchor.' },
      { status: 400 }
    );
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

  if ('isPublic' in body) {
    if (typeof body.isPublic !== 'boolean') {
      return NextResponse.json({ error: 'isPublic must be a boolean' }, { status: 400 });
    }
    if (existingPlan.ownerId !== user.id) {
      return NextResponse.json({ error: 'Only the template owner can change visibility' }, { status: 403 });
    }
    updates.isPublic = body.isPublic;
  }

  if (
    !('name' in body)
    && !('raceName' in body)
    && !('raceDate' in body)
    && !('startDate' in body)
    && !('weekDateAnchor' in body)
    && !('status' in body)
    && !('planGuide' in body)
    && !('planSummary' in body)
    && !('isPublic' in body)
  ) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
  }

  const planInclude = {
    weeks: {
      orderBy: { weekIndex: 'asc' as const },
      include: {
        days: {
          orderBy: { dayOfWeek: 'asc' as const },
          include: {
            activities: {
              orderBy: ACTIVITY_ORDER_BY
            }
          }
        }
      }
    },
    days: {
      orderBy: { dayOfWeek: 'asc' as const },
      include: {
        activities: {
          orderBy: ACTIVITY_ORDER_BY
        }
      }
    },
    activities: {
      orderBy: [{ dayId: 'asc' as const }, ...ACTIVITY_ORDER_BY]
    }
  };

  const hasPlanFieldUpdates = Object.keys(updates).length > 0;
  const plan = hasPlanFieldUpdates
    ? await prisma.trainingPlan.update({
      where: { id },
      data: updates,
      include: planInclude
    })
    : await prisma.trainingPlan.findUnique({
      where: { id },
      include: planInclude
    });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const totalWeeks = existingPlan.weekCount || plan.weeks.length;
  const clearWeekDates = async () => {
    await prisma.planWeek.updateMany({
      where: { planId: plan.id },
      data: { startDate: null, endDate: null }
    });
  };

  if (totalWeeks > 0) {
    if (nextStatus !== 'ACTIVE') {
      if (existingPlan.status === 'ACTIVE') {
        await clearWeekDates();
      }
    } else if (weekDateAnchor === 'START_DATE' && startDateValue) {
      await alignWeeksToStartDate(plan.id, totalWeeks, startDateValue);
    } else if (weekDateAnchor === 'RACE_DATE' && effectiveRaceDate) {
      await alignWeeksToRaceDate(plan.id, totalWeeks, effectiveRaceDate);
    } else if (startDatePatched) {
      if (startDateValue) {
        await alignWeeksToStartDate(plan.id, totalWeeks, startDateValue);
      } else {
        await clearWeekDates();
      }
    } else if (raceDatePatched) {
      if (updates.raceDate) {
        await alignWeeksToRaceDate(plan.id, totalWeeks, updates.raceDate);
      } else {
        await clearWeekDates();
      }
    } else if (isTransitioningToActive && effectiveRaceDate) {
      await alignWeeksToRaceDate(plan.id, totalWeeks, effectiveRaceDate);
    }
  }

  const refreshed = await prisma.trainingPlan.findUnique({
    where: { id: plan.id },
    include: planInclude
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
