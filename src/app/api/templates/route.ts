import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const raceType = url.searchParams.get('raceType');
  const difficulty = url.searchParams.get('difficulty');
  const minWeeks = url.searchParams.get('minWeeks');
  const maxWeeks = url.searchParams.get('maxWeeks');

  const where: any = { isTemplate: true, isPublic: true };
  if (raceType) where.raceType = raceType;
  if (difficulty) where.difficulty = difficulty;
  if (minWeeks || maxWeeks) {
    where.weekCount = {};
    if (minWeeks) where.weekCount.gte = Number(minWeeks);
    if (maxWeeks) where.weekCount.lte = Number(maxWeeks);
  }

  const templates = await prisma.trainingPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      weekCount: true,
      raceType: true,
      difficulty: true,
      ownerId: true,
      createdAt: true,
      planGuide: true,
      planSummary: true,
      owner: { select: { name: true } },
    },
  });

  return NextResponse.json({ templates });
}
