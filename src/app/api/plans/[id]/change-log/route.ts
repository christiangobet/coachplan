import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, OR: [{ ownerId: user.id }, { athleteId: user.id }] },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as {
    source: string;
    changeType: string;
    activityId?: string;
    fromDayId?: string;
    toDayId?: string;
    editSessionId?: string;
    before?: unknown;
    after?: unknown;
  };

  const entry = await prisma.planChangeLog.create({
    data: {
      planId,
      source: body.source,
      changeType: body.changeType,
      activityId: body.activityId ?? null,
      fromDayId: body.fromDayId ?? null,
      toDayId: body.toDayId ?? null,
      editSessionId: body.editSessionId ?? null,
      before: body.before ? (body.before as object) : undefined,
      after: body.after ? (body.after as object) : undefined,
    }
  });

  return NextResponse.json({ id: entry.id });
}
