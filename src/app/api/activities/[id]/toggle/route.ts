import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const activity = await prisma.planActivity.findUnique({
    where: { id },
    include: { plan: true }
  });
  if (!activity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (activity.plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const nowCompleted = !activity.completed;
  const updated = await prisma.planActivity.update({
    where: { id: activity.id },
    data: {
      completed: nowCompleted,
      completedAt: nowCompleted ? new Date() : null,
    }
  });

  return NextResponse.json({ activity: updated });
}
