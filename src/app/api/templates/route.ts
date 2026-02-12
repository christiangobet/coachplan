import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const templates = await prisma.trainingPlan.findMany({
    where: { isTemplate: true },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json({ templates });
}
