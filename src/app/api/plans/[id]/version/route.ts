// Lightweight plan version check for cross-device polling.
// Returns a fingerprint (activity count + latest change timestamp).
// Client polls every 30s and only calls loadPlan() if fingerprint changed.
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function GET(
  _req: Request,
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

  const [activityCount, latestChange] = await Promise.all([
    prisma.planActivity.count({ where: { planId } }),
    prisma.planChangeLog.findFirst({
      where: { planId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    }),
  ]);

  const version = `${activityCount}-${latestChange?.createdAt.toISOString() ?? '0'}`;
  return NextResponse.json({ version });
}
