import { prisma } from '@/lib/prisma';

export async function resetPlanSchedule(planId: string) {
  const planActivityIds = await prisma.planActivity.findMany({
    where: { planId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    if (planActivityIds.length > 0) {
      await tx.externalActivity.updateMany({
        where: {
          matchedPlanActivityId: {
            in: planActivityIds.map((activity) => activity.id),
          },
        },
        data: {
          matchedPlanActivityId: null,
        },
      });
    }

    await tx.planActivity.deleteMany({ where: { planId } });
    await tx.planDay.deleteMany({ where: { planId } });
    await tx.planWeek.deleteMany({ where: { planId } });
  });
}
