import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';

export async function POST(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await req.json();
  const coachId = body?.coachId as string;
  if (!coachId) return NextResponse.json({ error: 'Coach required' }, { status: 400 });

  await prisma.coachAthlete.upsert({
    where: { coachId_athleteId: { coachId, athleteId: access.context.userId } },
    update: {},
    create: { coachId, athleteId: access.context.userId }
  });

  return NextResponse.json({ linked: true });
}
