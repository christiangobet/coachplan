import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import { exchangeStravaCodeForAccount, syncStravaActivitiesForUser } from '@/lib/integrations/strava';
import { verifyIntegrationStateToken } from '@/lib/integrations/state';

function redirectToProfile(req: Request, params?: Record<string, string>) {
  const url = new URL('/profile', req.url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(url);
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function getLookbackDaysFromPlanStart(userId: string): Promise<number> {
  const plan = await prisma.trainingPlan.findFirst({
    where: {
      athleteId: userId,
      isTemplate: false,
      status: 'ACTIVE'
    },
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
  }) || await prisma.trainingPlan.findFirst({
    where: {
      athleteId: userId,
      isTemplate: false,
      status: 'DRAFT'
    },
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
  }) || await prisma.trainingPlan.findFirst({
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

  if (!plan) return 365;

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

  if (!planStart) return 365;
  const today = startOfDay(new Date());
  const diffMs = today.getTime() - startOfDay(planStart).getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(diffDays, 1), 3650);
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', req.url));

  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const stateToken = url.searchParams.get('state');

  if (error) {
    return redirectToProfile(req, { integrationError: `strava_${error}` });
  }
  if (!code || !stateToken) {
    return redirectToProfile(req, { integrationError: 'strava_missing_code_or_state' });
  }

  let state = null;
  try {
    state = verifyIntegrationStateToken(stateToken, 15 * 60 * 1000);
  } catch {
    return redirectToProfile(req, { integrationError: 'strava_state_secret_missing' });
  }
  if (!state || state.provider !== 'STRAVA') {
    return redirectToProfile(req, { integrationError: 'strava_invalid_state' });
  }
  if (state.userId !== user.id) {
    return redirectToProfile(req, { integrationError: 'strava_state_mismatch' });
  }

  try {
    await exchangeStravaCodeForAccount({
      userId: user.id,
      code,
      origin: url.origin
    });
  } catch (exchangeError: unknown) {
    const message = exchangeError instanceof Error ? exchangeError.message : 'strava_exchange_failed';
    return redirectToProfile(req, { integrationError: message.slice(0, 120) });
  }

  try {
    const lookbackDays = await getLookbackDaysFromPlanStart(user.id);
    await syncStravaActivitiesForUser({
      userId: user.id,
      lookbackDays,
      forceLookback: true
    });
  } catch {
    return redirectToProfile(req, { integration: 'strava_connected', integrationWarning: 'sync_failed' });
  }

  return redirectToProfile(req, { integration: 'strava_connected' });
}
