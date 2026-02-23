import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { isDayClosed } from '@/lib/day-status';
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';

function toDateKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateKey(key: string) {
  const parsed = new Date(`${key}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateLabel(key: string) {
  const parsed = fromDateKey(key);
  if (!parsed) return key;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getStravaDateKeyFromRaw(raw: unknown, fallbackStartTime: Date) {
  if (raw && typeof raw === 'object') {
    const asRecord = raw as Record<string, unknown>;
    const localStart = asRecord.start_date_local;
    if (typeof localStart === 'string' && /^\d{4}-\d{2}-\d{2}/.test(localStart)) {
      return localStart.slice(0, 10);
    }
  }
  return toDateKey(fallbackStartTime);
}

function isLockedPlanDay(notes: string | null | undefined, activities: Array<{ completed: boolean }>) {
  return isDayClosed(notes) || (activities.length > 0 && activities.every((activity) => activity.completed));
}

export async function GET(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const profile = await prisma.user.findUnique({
    where: { id: access.context.userId },
    select: { units: true }
  });
  const viewerUnits = profile?.units === 'KM' ? 'KM' : 'MILES';
  const url = new URL(req.url);
  const requestedPlanId = url.searchParams.get('plan')?.trim() || '';
  const cookieStore = await cookies();
  const cookiePlanId = cookieStore.get(SELECTED_PLAN_COOKIE)?.value || '';

  const account = await prisma.externalAccount.findUnique({
    where: {
      userId_provider: {
        userId: access.context.userId,
        provider: 'STRAVA'
      }
    },
    select: {
      providerUsername: true,
      lastSyncAt: true,
      syncCursor: true
    }
  });

  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: access.context.userId, isTemplate: false },
    orderBy: { createdAt: 'desc' },
    include: {
      weeks: {
        include: {
          days: {
            include: { activities: true }
          }
        }
      }
    }
  });
  const activePlan = pickSelectedPlan(plans, {
    requestedPlanId,
    cookiePlanId
  });

  const planByDate = new Map<string, Array<{
    id: string;
    title: string;
    type: string;
    distance: number | null;
    distanceUnit: string | null;
    duration: number | null;
    completed: boolean;
    actualDistance: number | null;
    actualDuration: number | null;
    actualPace: string | null;
    matchedExternalActivityId: string | null;
  }>>();
  const lockedPlanDayByDate = new Map<string, boolean>();
  let planStart: Date | null = null;

  if (activePlan) {
    const weeks = [...activePlan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
    const allWeekIndexes = weeks.map((week) => week.weekIndex);
    for (const week of weeks) {
      const bounds = resolveWeekBounds({
        weekIndex: week.weekIndex,
        weekStartDate: week.startDate,
        weekEndDate: week.endDate,
        raceDate: activePlan.raceDate,
        weekCount: activePlan.weekCount,
        allWeekIndexes
      });
      for (const day of week.days || []) {
        const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
        if (!dayDate) continue;
        if (!planStart || dayDate < planStart) planStart = dayDate;
        const key = toDateKey(dayDate);
        const row = planByDate.get(key) || [];
        const dayLocked = isLockedPlanDay(day.notes, day.activities || []);
        lockedPlanDayByDate.set(key, Boolean(lockedPlanDayByDate.get(key) || dayLocked));
        for (const activity of day.activities || []) {
          row.push({
            id: activity.id,
            title: activity.title || activity.type.replace(/_/g, ' '),
            type: activity.type,
            distance: activity.distance ?? null,
            distanceUnit: activity.distanceUnit ?? null,
            duration: activity.duration ?? null,
            completed: activity.completed,
            actualDistance: activity.actualDistance ?? null,
            actualDuration: activity.actualDuration ?? null,
            actualPace: activity.actualPace ?? null,
            matchedExternalActivityId: null
          });
        }
        planByDate.set(key, row);
      }
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fallbackStart = new Date(today);
  fallbackStart.setDate(fallbackStart.getDate() - 21);
  const windowStart = planStart && planStart <= today ? planStart : fallbackStart;
  const windowEnd = today;

  const externalActivities = await prisma.externalActivity.findMany({
    where: {
      userId: access.context.userId,
      provider: 'STRAVA',
      startTime: {
        gte: windowStart,
        lte: new Date(windowEnd.getTime() + (24 * 60 * 60 * 1000) - 1)
      }
    },
    orderBy: [{ startTime: 'desc' }]
  });

  const stravaByDate = new Map<string, Array<{
    id: string;
    name: string;
    sportType: string | null;
    startTime: string;
    distanceM: number | null;
    durationSec: number | null;
    avgHeartRate: number | null;
    calories: number | null;
    matchedPlanActivityId: string | null;
    equivalence: 'FULL' | 'PARTIAL' | 'NONE' | null;
    equivalenceOverride: 'FULL' | 'PARTIAL' | 'NONE' | null;
    equivalenceNote: string | null;
    equivalenceConfidence: number | null;
    loadRatio: number | null;
  }>>();

  for (const external of externalActivities) {
    const key = getStravaDateKeyFromRaw(external.raw, external.startTime);
    const row = stravaByDate.get(key) || [];
    row.push({
      id: external.id,
      name: external.name || external.sportType || 'Strava activity',
      sportType: external.sportType,
      startTime: external.startTime.toISOString(),
      distanceM: external.distanceM ?? null,
      durationSec: external.durationSec ?? null,
      avgHeartRate: external.avgHeartRate ?? null,
      calories: external.calories ?? null,
      matchedPlanActivityId: external.matchedPlanActivityId ?? null,
      equivalence: external.equivalence ?? null,
      equivalenceOverride: external.equivalenceOverride ?? null,
      equivalenceNote: external.equivalenceNote ?? null,
      equivalenceConfidence: external.equivalenceConfidence ?? null,
      loadRatio: external.loadRatio ?? null
    });
    stravaByDate.set(key, row);
  }

  const matchedExternalByPlanActivityId = new Map<string, string>();
  for (const stravaList of stravaByDate.values()) {
    for (const stravaActivity of stravaList) {
      if (!stravaActivity.matchedPlanActivityId) continue;
      matchedExternalByPlanActivityId.set(stravaActivity.matchedPlanActivityId, stravaActivity.id);
    }
  }

  for (const planList of planByDate.values()) {
    for (const planActivity of planList) {
      planActivity.matchedExternalActivityId = matchedExternalByPlanActivityId.get(planActivity.id) || null;
    }
  }

  const allDateKeys = new Set<string>([...planByDate.keys(), ...stravaByDate.keys()]);
  const sortedKeys = [...allDateKeys]
    .filter((key) => {
      const parsed = fromDateKey(key);
      if (!parsed) return false;
      return parsed >= windowStart && parsed <= windowEnd;
    })
    .sort((a, b) => b.localeCompare(a));

  const days = sortedKeys.map((key) => ({
    date: key,
    label: formatDateLabel(key),
    isToday: key === toDateKey(today),
    isLockedPlanDay: Boolean(lockedPlanDayByDate.get(key)),
    planActivities: planByDate.get(key) || [],
    stravaActivities: stravaByDate.get(key) || []
  }));

  const unmatchedPlan = days.reduce(
    (sum, day) => sum + day.planActivities.filter((activity) => !activity.matchedExternalActivityId).length,
    0
  );
  const unmatchedStrava = days.reduce(
    (sum, day) => sum + day.stravaActivities.filter((activity) => !activity.matchedPlanActivityId).length,
    0
  );

  return NextResponse.json({
    viewerUnits,
    account: {
      connected: Boolean(account),
      providerUsername: account?.providerUsername || null,
      lastSyncAt: account?.lastSyncAt?.toISOString() || null,
      syncCursor: account?.syncCursor || null
    },
    plan: activePlan
      ? {
          id: activePlan.id,
          name: activePlan.name
        }
      : null,
    summary: {
      dayCount: days.length,
      unmatchedPlan,
      unmatchedStrava
    },
    days
  });
}
