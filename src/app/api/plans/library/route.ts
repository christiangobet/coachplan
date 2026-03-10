import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { buildPlanBanner } from '@/lib/plan-banner';

type NextActivityCandidate = {
  id: string;
  title: string;
  type: string;
  distance: number | null;
  distanceUnit: string | null;
  duration: number | null;
  weekIndex: number | null;
  dayOfWeek: number | null;
  dateISO: string | null;
};

function toLocalDateKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function resolveActivityDateISO(startDate: Date | null, dayOfWeek: number | null) {
  if (!startDate || !dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) return null;
  const next = new Date(startDate);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + dayOfWeek - 1);
  return toLocalDateKey(next);
}


export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [plansRaw, myTemplates, publicTemplates] = await Promise.all([
    prisma.trainingPlan.findMany({
      where: { athleteId: user.id, isTemplate: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        weekCount: true,
        status: true,
        raceName: true,
        raceDate: true,
        raceType: true,
        difficulty: true,
        createdAt: true,
        bannerImageId: true,
        bannerImage: {
          select: { focusY: true }
        },
        planGuide: true,
        // Use aggregate counts instead of loading all activities
        _count: {
          select: {
            activities: true,
            // Filtered counts: completed and key activities
          }
        },
        // Only fetch the first upcoming uncompleted activity (ordered by week + day)
        activities: {
          where: { completed: false },
          take: 1,
          orderBy: [
            { day: { week: { weekIndex: 'asc' } } },
            { day: { dayOfWeek: 'asc' } },
            { sessionOrder: 'asc' }
          ],
          select: {
            id: true,
            title: true,
            type: true,
            distance: true,
            distanceUnit: true,
            duration: true,
            day: {
              select: {
                dayOfWeek: true,
                week: {
                  select: { weekIndex: true, startDate: true }
                }
              }
            }
          }
        }
      }
    }),
    prisma.trainingPlan.findMany({
      where: { isTemplate: true, ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        weekCount: true,
        isPublic: true,
        raceType: true,
        difficulty: true,
        planGuide: true,
        planSummary: true,
        createdAt: true
      }
    }),
    prisma.trainingPlan.findMany({
      where: { isTemplate: true, isPublic: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        weekCount: true,
        isPublic: true,
        raceType: true,
        difficulty: true,
        planGuide: true,
        planSummary: true,
        createdAt: true,
        owner: { select: { name: true } }
      }
    })
  ]);

  // Batch stats queries across all plans — avoids loading all activity rows
  const planIds = plansRaw.map((p) => p.id);
  const [completionGroups, keyGroups, keyCompletedGroups] = await Promise.all([
    prisma.planActivity.groupBy({
      by: ['planId', 'completed'],
      where: { planId: { in: planIds } },
      _count: { id: true }
    }),
    prisma.planActivity.groupBy({
      by: ['planId'],
      where: { planId: { in: planIds }, OR: [{ mustDo: true }, { priority: 'KEY' }] },
      _count: { id: true }
    }),
    prisma.planActivity.groupBy({
      by: ['planId'],
      where: { planId: { in: planIds }, OR: [{ mustDo: true }, { priority: 'KEY' }], completed: true },
      _count: { id: true }
    })
  ]);

  const statsByPlanId = new Map<string, { total: number; completed: number; key: number; keyCompleted: number }>();
  for (const group of completionGroups) {
    const entry = statsByPlanId.get(group.planId) ?? { total: 0, completed: 0, key: 0, keyCompleted: 0 };
    entry.total += group._count.id;
    if (group.completed) entry.completed = group._count.id;
    statsByPlanId.set(group.planId, entry);
  }
  for (const group of keyGroups) {
    const entry = statsByPlanId.get(group.planId) ?? { total: 0, completed: 0, key: 0, keyCompleted: 0 };
    entry.key = group._count.id;
    statsByPlanId.set(group.planId, entry);
  }
  for (const group of keyCompletedGroups) {
    const entry = statsByPlanId.get(group.planId) ?? { total: 0, completed: 0, key: 0, keyCompleted: 0 };
    entry.keyCompleted = group._count.id;
    statsByPlanId.set(group.planId, entry);
  }

  const plans = plansRaw.map((plan) => {
    const s = statsByPlanId.get(plan.id) ?? { total: 0, completed: 0, key: 0, keyCompleted: 0 };
    const totalActivities = s.total;
    const completedActivities = s.completed;
    const keyActivities = s.key;
    const keyCompleted = s.keyCompleted;

    // next activity is pre-fetched with take:1, ordered by week+day
    const nextRaw = plan.activities[0] ?? null;
    const nextActivity: NextActivityCandidate | null = nextRaw
      ? {
          id: nextRaw.id,
          title: nextRaw.title,
          type: nextRaw.type,
          distance: nextRaw.distance ?? null,
          distanceUnit: nextRaw.distanceUnit ?? null,
          duration: nextRaw.duration ?? null,
          weekIndex: nextRaw.day?.week?.weekIndex ?? null,
          dayOfWeek: nextRaw.day?.dayOfWeek ?? null,
          dateISO: resolveActivityDateISO(nextRaw.day?.week?.startDate ?? null, nextRaw.day?.dayOfWeek ?? null)
        }
      : null;

    const progress = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

    return {
      id: plan.id,
      name: plan.name,
      weekCount: plan.weekCount,
      status: plan.status,
      progress,
      raceName: plan.raceName,
      raceDate: plan.raceDate,
      raceType: plan.raceType,
      difficulty: plan.difficulty,
      createdAt: plan.createdAt,
      banner: buildPlanBanner(plan.id, plan.bannerImageId, plan.bannerImage?.focusY ?? null),
      planGuide: plan.planGuide,
      stats: {
        totalActivities,
        completedActivities,
        keyActivities,
        keyCompleted
      },
      nextActivity
    };
  });

  const summary = {
    total: plans.length,
    active: plans.filter((plan) => plan.status === 'ACTIVE').length,
    draft: plans.filter((plan) => plan.status === 'DRAFT').length,
    archived: plans.filter((plan) => plan.status === 'ARCHIVED').length
  };

  return NextResponse.json({
    plans,
    myTemplates,
    publicTemplates,
    summary
  });
}
