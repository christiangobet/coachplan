import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const links = await prisma.coachAthlete.findMany({
    where: { coachId: user.id },
    include: { athlete: true }
  });

  return NextResponse.json({ athletes: links.map((l) => l.athlete) });
}
