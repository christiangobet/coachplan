import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const coachId = body?.coachId as string;
  if (!coachId) return NextResponse.json({ error: 'Coach required' }, { status: 400 });

  await prisma.coachAthlete.upsert({
    where: { coachId_athleteId: { coachId, athleteId: user.id } },
    update: {},
    create: { coachId, athleteId: user.id }
  });

  return NextResponse.json({ linked: true });
}
