import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId } = await params;

  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: {
      ownerId: true,
      athleteId: true,
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

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== userId && plan.athleteId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let daysGrouped = 0;
  let activitiesTagged = 0;

  try {
    for (const week of plan.weeks) {
      for (const day of week.days) {
        // Only consider activities without an existing sessionGroupId
        const ungrouped = day.activities.filter((a) => !a.sessionGroupId);

        // Require 2+ activities, all of type RUN (no REST, no strength, etc.)
        if (ungrouped.length < 2) continue;
        if (!ungrouped.every((a) => a.type === 'RUN')) continue;

        const groupId = randomUUID();
        await prisma.planActivity.updateMany({
          where: { id: { in: ungrouped.map((a) => a.id) } },
          data: { sessionGroupId: groupId }
        });

        // Set sessionOrder individually (updateMany can't set different values per row)
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error';
    console.error('[assign-session-groups]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ daysGrouped, activitiesTagged });
}
