import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';
import { getDayMissedReason, getDayStatus, setDayStatus, type DayStatus } from '@/lib/day-status';

type Body = {
  completed?: unknown;
  status?: unknown;
  reason?: unknown;
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

  const currentStatus = getDayStatus(day.notes);
  let nextStatus: DayStatus;

  if (typeof body.status === 'string') {
    const normalized = body.status.trim().toUpperCase();
    if (normalized !== 'OPEN' && normalized !== 'DONE' && normalized !== 'MISSED' && normalized !== 'PARTIAL') {
      return NextResponse.json({ error: 'status must be OPEN, DONE, MISSED, or PARTIAL' }, { status: 400 });
    }
    nextStatus = normalized as DayStatus;
  } else if (body.completed !== undefined) {
    nextStatus = Boolean(body.completed) ? 'DONE' : 'OPEN';
  } else {
    nextStatus = currentStatus === 'DONE' ? 'OPEN' : 'DONE';
  }

  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
    return NextResponse.json({ error: 'reason must be text' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
  if (reason && reason.length > 240) {
    return NextResponse.json({ error: 'reason is too long' }, { status: 400 });
  }

  const nextNotes = setDayStatus(day.notes, nextStatus, reason);

  const updated = await prisma.planDay.update({
    where: { id: day.id },
    data: { notes: nextNotes },
    select: { id: true, notes: true }
  });

  const status = getDayStatus(updated.notes);

  return NextResponse.json({
    day: {
      id: updated.id,
      status,
      completed: status === 'DONE',
      missed: status === 'MISSED',
      reason: getDayMissedReason(updated.notes)
    }
  });
}
