import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const coaches = await prisma.user.findMany({
    where: { role: 'COACH' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true }
  });
  return NextResponse.json({ coaches });
}
