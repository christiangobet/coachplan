import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const coaches = await prisma.user.findMany({
    where: { role: 'COACH' },
    orderBy: { createdAt: 'desc' }
  });
  return NextResponse.json({ coaches });
}
