import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { assignSessionGroups } from '@/lib/assign-session-groups';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId } = await params;

  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: { ownerId: true, athleteId: true }
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== userId && plan.athleteId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await assignSessionGroups(planId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error';
    console.error('[assign-session-groups]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
