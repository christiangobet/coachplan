import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);

  const plan = await prisma.trainingPlan.findFirst({
    where: {
      id: planId,
      OR: [{ ownerId: user.id }, { athleteId: user.id }]
    },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const editSessionId = randomUUID();
  return NextResponse.json({ editSessionId });
}
