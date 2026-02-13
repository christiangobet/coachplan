import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';

export async function GET() {
  const access = await requireRoleApi('COACH');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const links = await prisma.coachAthlete.findMany({
    where: { coachId: access.context.userId },
    include: {
      athlete: {
        select: {
          id: true,
          name: true,
          email: true,
          goalRaceDate: true,
          athletePlans: {
            where: { isTemplate: false, status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              name: true,
              raceName: true,
              raceDate: true,
              weekCount: true,
              weeks: {
                select: {
                  days: {
                    select: {
                      activities: {
                        select: {
                          id: true,
                          completed: true
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  const athletes = links.map((link) => {
    const athlete = link.athlete;
    const activePlan = athlete.athletePlans[0] || null;
    const planActivities = activePlan
      ? activePlan.weeks.flatMap((week) =>
          week.days.flatMap((day) => day.activities)
        )
      : [];
    const totalActivities = planActivities.length;
    const completedActivities = planActivities.filter((activity) => activity.completed).length;
    const completionPct = totalActivities > 0
      ? Math.round((completedActivities / totalActivities) * 100)
      : 0;

    return {
      id: athlete.id,
      name: athlete.name,
      email: athlete.email,
      goalRaceDate: athlete.goalRaceDate,
      activePlan: activePlan
        ? {
            id: activePlan.id,
            name: activePlan.name,
            raceName: activePlan.raceName,
            raceDate: activePlan.raceDate,
            weekCount: activePlan.weekCount,
            totalActivities,
            completedActivities,
            completionPct
          }
        : null
    };
  });

  return NextResponse.json({ athletes });
}
