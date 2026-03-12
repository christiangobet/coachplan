// src/lib/plan-performance-context.ts
// Builds a human-readable summary of the athlete's last 14 days of
// completed activities (Strava-matched + manually logged) for AI context.

import { prisma } from '@/lib/prisma';

function formatPace(secPerKm: number | null | undefined): string | null {
  if (!secPerKm) return null;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/km`;
}

function formatDistance(distanceM: number | null | undefined): string | null {
  if (!distanceM) return null;
  return `${(distanceM / 1000).toFixed(1)}km`;
}

function resolveActivityDate(activity: {
  completedAt: Date | null;
  day: {
    dayOfWeek: number;
    week: { startDate: Date | null };
  };
}): Date | null {
  if (activity.completedAt) return activity.completedAt;
  const startDate = activity.day.week.startDate;
  if (!startDate) return null;
  const date = new Date(startDate);
  date.setDate(date.getDate() + (activity.day.dayOfWeek - 1));
  return date;
}

export async function buildPerformanceContext(planId: string): Promise<string> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const activities = await prisma.planActivity.findMany({
    where: {
      planId,
      completed: true,
      OR: [
        { completedAt: { gte: cutoff } },
        { completedAt: null }
      ]
    },
    select: {
      id: true,
      title: true,
      type: true,
      completedAt: true,
      actualPace: true,
      actualDuration: true,
      actualDistance: true,
      day: {
        select: {
          dayOfWeek: true,
          week: { select: { startDate: true } }
        }
      },
      externalActivities: {
        where: { matchedPlanActivityId: { not: null } },
        select: {
          avgHeartRate: true,
          movingTimeSec: true,
          distanceM: true,
          avgPaceSecPerKm: true,
        },
        take: 1,
      }
    },
    orderBy: { completedAt: 'desc' },
    take: 30,
  });

  const recentActivities = activities.filter((a) => {
    const date = resolveActivityDate(a);
    return date && date >= cutoff;
  });

  if (recentActivities.length === 0) return '';

  const lines = recentActivities.map((a) => {
    const date = resolveActivityDate(a);
    const dateStr = date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Unknown date';

    const strava = a.externalActivities[0];
    const hasStrava = !!strava;

    const distance = hasStrava
      ? formatDistance(strava.distanceM)
      : a.actualDistance ? `${a.actualDistance}km` : null;

    const pace = hasStrava
      ? formatPace(strava.avgPaceSecPerKm)
      : a.actualPace ?? null;

    const hr = hasStrava && strava.avgHeartRate
      ? `, HR ${strava.avgHeartRate}`
      : '';

    const source = hasStrava ? '[Strava]' : '[manual]';

    const parts = [distance, pace ? `@ ${pace}` : null].filter(Boolean).join(' ');
    return `  ${dateStr} — ${a.title}${parts ? ` ${parts}` : ''}${hr} ${source}`;
  });

  return `Recent performance (last 14 days):\n${lines.join('\n')}`;
}
