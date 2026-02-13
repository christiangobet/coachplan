import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

function normalizeOptionalText(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  return value || null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: planId, dayId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: { id: true, ownerId: true, athleteId: true, status: true }
  });

  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (plan.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only draft plans can be edited in review' }, { status: 400 });
  }

  const rawText = normalizeOptionalText((body as { rawText?: unknown }).rawText);
  const notes = normalizeOptionalText((body as { notes?: unknown }).notes);

  if (rawText === undefined && notes === undefined) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const day = await prisma.planDay.findFirst({
    where: { id: dayId, planId },
    select: { id: true }
  });
  if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 });

  const updated = await prisma.planDay.update({
    where: { id: dayId },
    data: {
      ...(rawText !== undefined ? { rawText } : {}),
      ...(notes !== undefined ? { notes } : {})
    },
    include: { activities: true }
  });

  return NextResponse.json({ day: updated });
}
