import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';

/**
 * For a given plan, find every day that has 2+ ungrouped RUN activities
 * and assign them a shared sessionGroupId + sequential sessionOrder.
 *
 * Safe to call multiple times — already-grouped activities are skipped.
 */
export async function assignSessionGroups(planId: string): Promise<{ daysGrouped: number; activitiesTagged: number }> {
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: {
      weeks: {
        select: {
          days: {
            select: {
              activities: {
                select: { id: true, type: true, sessionGroupId: true },
                orderBy: { id: 'asc' }
              }
            }
          }
        }
      }
    }
  });

  if (!plan) return { daysGrouped: 0, activitiesTagged: 0 };

  let daysGrouped = 0;
  let activitiesTagged = 0;

  for (const week of plan.weeks) {
    for (const day of week.days) {
      const ungrouped = day.activities.filter((a) => !a.sessionGroupId);

      if (ungrouped.length < 2) continue;
      if (!ungrouped.every((a) => a.type === 'RUN')) continue;

      const groupId = randomUUID();
      await prisma.planActivity.updateMany({
        where: { id: { in: ungrouped.map((a) => a.id) } },
        data: { sessionGroupId: groupId }
      });

      await Promise.all(
        ungrouped.map((a, i) =>
          prisma.planActivity.update({
            where: { id: a.id },
            data: { sessionOrder: i + 1 }
          })
        )
      );

      daysGrouped++;
      activitiesTagged += ungrouped.length;
    }
  }

  return { daysGrouped, activitiesTagged };
}
