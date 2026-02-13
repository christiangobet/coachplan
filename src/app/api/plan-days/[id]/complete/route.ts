import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';
import { isDayMarkedDone, setDayMarkedDone } from '@/lib/day-status';

type Body = {
  completed?: unknown;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing day id' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const day = await prisma.planDay.findUnique({
    where: { id },
    select: {
      id: true,
      notes: true,
      plan: { select: { athleteId: true } }
    }
  });

  if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 });
  if (day.plan.athleteId !== access.context.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const current = isDayMarkedDone(day.notes);
  const nextCompleted = body.completed === undefined ? !current : Boolean(body.completed);
  const nextNotes = setDayMarkedDone(day.notes, nextCompleted);

  const updated = await prisma.planDay.update({
    where: { id: day.id },
    data: { notes: nextNotes },
    select: { id: true, notes: true }
  });

  return NextResponse.json({
    day: {
      id: updated.id,
      completed: isDayMarkedDone(updated.notes)
    }
  });
}
