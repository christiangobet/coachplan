import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRoleApi } from '@/lib/role-guards';
import { syncStravaActivitiesForUser } from '@/lib/integrations/strava';
import { prisma } from '@/lib/prisma';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';

function parseLookbackDays(raw: unknown) {
  if (raw === undefined || raw === null || raw === '') return 30;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return Math.min(Math.max(numeric, 1), 3650);
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function getPlanStartDate(userId: string, preferredPlanId?: string | null): Promise<Date | null> {
  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: userId, isTemplate: false },
    orderBy: { createdAt: 'desc' },
    include: {
      weeks: {
        include: {
          days: {
            select: { dayOfWeek: true }
          }
        }
      }
    }
  });
  const plan = pickSelectedPlan(plans, {
    cookiePlanId: preferredPlanId
  });

  if (!plan) return null;

  const weeks = [...(plan.weeks || [])].sort((a, b) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((week) => week.weekIndex);
  let planStart: Date | null = null;
  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: plan.raceDate,
      weekCount: plan.weekCount,
      allWeekIndexes
    });
    for (const day of week.days || []) {
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      if (!dayDate) continue;
      if (!planStart || dayDate < planStart) {
        planStart = dayDate;
      }
    }
  }

  return planStart ? startOfDay(planStart) : null;
}

export async function POST(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const cookieStore = await cookies();
  const cookiePlanId = cookieStore.get(SELECTED_PLAN_COOKIE)?.value || null;

  const body = await req.json().catch(() => ({}));
  const explicitPlanId = typeof (body as Record<string, unknown>)?.planId === 'string'
    ? String((body as Record<string, unknown>).planId).trim()
    : '';
  const preferredPlanId = explicitPlanId || cookiePlanId;
  const parsedLookback = parseLookbackDays((body as Record<string, unknown>)?.lookbackDays);
  const syncFromPlanStart = Boolean((body as Record<string, unknown>)?.syncFromPlanStart);
  let lookbackDays = parsedLookback;
  let forceLookback = Boolean((body as Record<string, unknown>)?.forceLookback);

  if (syncFromPlanStart) {
    const planStart = await getPlanStartDate(access.context.userId, preferredPlanId);
    if (planStart) {
      const today = startOfDay(new Date());
      const diffMs = today.getTime() - planStart.getTime();
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
      lookbackDays = Math.min(Math.max(diffDays, 1), 3650);
      forceLookback = true;
    }
  }

  if (lookbackDays === null) {
    return NextResponse.json({ error: 'lookbackDays must be a positive integer' }, { status: 400 });
  }

  try {
    const summary = await syncStravaActivitiesForUser({
      userId: access.context.userId,
      lookbackDays,
      forceLookback,
      preferredPlanId
    });
    return NextResponse.json({ summary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to sync Strava activities';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
