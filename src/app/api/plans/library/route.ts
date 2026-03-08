import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

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

function pickNextActivity(candidates: NextActivityCandidate[]) {
  if (!candidates.length) return null;
  const todayKey = toLocalDateKey(new Date());
  const sorted = [...candidates].sort((a, b) => {
    const aDate = a.dateISO ?? '9999-99-99';
    const bDate = b.dateISO ?? '9999-99-99';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    const aWeek = a.weekIndex ?? 999;
    const bWeek = b.weekIndex ?? 999;
    if (aWeek !== bWeek) return aWeek - bWeek;
    const aDay = a.dayOfWeek ?? 999;
    const bDay = b.dayOfWeek ?? 999;
    return aDay - bDay;
  });
  const futureOrToday = sorted.find((activity) => activity.dateISO && activity.dateISO >= todayKey);
  return futureOrToday || sorted[0];
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
        planGuide: true,
        activities: {
          select: {
            id: true,
            title: true,
            type: true,
            distance: true,
            distanceUnit: true,
            duration: true,
            completed: true,
            mustDo: true,
            priority: true,
            day: {
              select: {
                dayOfWeek: true,
                week: {
                  select: {
                    weekIndex: true,
                    startDate: true
                  }
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

  const plans = plansRaw.map((plan) => {
    const totalActivities = plan.activities.length;
    const completedActivities = plan.activities.filter((activity) => activity.completed).length;
    const keyActivities = plan.activities.filter((activity) => activity.mustDo || activity.priority === 'KEY').length;
    const keyCompleted = plan.activities.filter(
      (activity) => (activity.mustDo || activity.priority === 'KEY') && activity.completed
    ).length;

    const nextCandidates: NextActivityCandidate[] = plan.activities
      .filter((activity) => !activity.completed)
      .map((activity) => ({
        id: activity.id,
        title: activity.title,
        type: activity.type,
        distance: activity.distance ?? null,
        distanceUnit: activity.distanceUnit ?? null,
        duration: activity.duration ?? null,
        weekIndex: activity.day?.week?.weekIndex ?? null,
        dayOfWeek: activity.day?.dayOfWeek ?? null,
        dateISO: resolveActivityDateISO(activity.day?.week?.startDate ?? null, activity.day?.dayOfWeek ?? null)
      }));

    const nextActivity = pickNextActivity(nextCandidates);
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
