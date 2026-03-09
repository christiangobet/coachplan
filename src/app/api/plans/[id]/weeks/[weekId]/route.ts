import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; weekId: string }> }
) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(authUser, { defaultRole: 'ATHLETE' });
  const { id: planId, weekId } = await params;

  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      weeks: {
        orderBy: { weekIndex: 'asc' },
        select: {
          id: true,
          weekIndex: true,
          days: {
            select: {
              id: true,
              activities: {
                select: {
                  id: true,
                  completed: true,
                  actualDistance: true,
                  actualDuration: true,
                  actualPace: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!plan.weeks.length) {
    return NextResponse.json({ error: 'Plan has no weeks to delete' }, { status: 400 });
  }

  const targetWeek = plan.weeks.find((week) => week.id === weekId);
  if (!targetWeek) {
    return NextResponse.json({ error: 'Week not found in this plan' }, { status: 404 });
  }

  if (plan.weeks.length <= 1) {
    return NextResponse.json(
      { error: 'Cannot delete the only remaining week in a plan' },
      { status: 400 }
    );
  }

  const lastWeekIndex = Math.max(...plan.weeks.map((week) => week.weekIndex));
  if (targetWeek.weekIndex !== lastWeekIndex) {
    return NextResponse.json(
      { error: 'Only the last week can be deleted' },
      { status: 400 }
    );
  }

  const hasPlannedOrLoggedActivities = targetWeek.days.some((day) => day.activities.length > 0);
  if (hasPlannedOrLoggedActivities) {
    const hasLogged = targetWeek.days.some((day) =>
      day.activities.some((activity) =>
        activity.completed
        || activity.actualDistance !== null
        || activity.actualDuration !== null
        || Boolean(activity.actualPace)
      )
    );
    return NextResponse.json(
      {
        error: hasLogged
          ? 'Week has logged activities. Clear logged/planned activities first.'
          : 'Week has planned activities. Clear the week first.'
      },
      { status: 400 }
    );
  }

  const remainingWeekIndexes = plan.weeks
    .filter((week) => week.id !== targetWeek.id)
    .map((week) => week.weekIndex);
  const nextWeekCount = remainingWeekIndexes.length > 0 ? Math.max(...remainingWeekIndexes) : 0;

  await prisma.$transaction(async (tx) => {
    await tx.planActivity.deleteMany({
      where: {
        planId,
        day: { weekId: targetWeek.id }
      }
    });

    await tx.planDay.deleteMany({
      where: { weekId: targetWeek.id }
    });

    await tx.planWeek.delete({
      where: { id: targetWeek.id }
    });

    await tx.trainingPlan.update({
      where: { id: planId },
      data: { weekCount: nextWeekCount }
    });
  });

  return NextResponse.json({
    success: true,
    deletedWeekId: targetWeek.id,
    deletedWeekIndex: targetWeek.weekIndex,
    weekCount: nextWeekCount
  });
}

