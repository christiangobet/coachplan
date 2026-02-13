import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { clonePlanStructure } from '@/lib/clone-plan';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
    },
  });

  if (!plan || plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 });
  }

  const template = await prisma.trainingPlan.create({
    data: {
      name: body?.name || plan.name,
      description: body?.description || null,
      isTemplate: true,
      isPublic: body?.isPublic ?? true,
      status: 'ACTIVE',
      weekCount: plan.weekCount,
      raceName: body?.raceName || plan.raceName || null,
      raceType: body?.raceType || plan.raceType || null,
      difficulty: body?.difficulty || null,
      ownerId: user.id,
      sourceId: plan.id,
    },
  });

  await clonePlanStructure(plan, template.id);
  await prisma.planWeek.updateMany({
    where: { planId: template.id },
    data: { startDate: null, endDate: null }
  });

  return NextResponse.json({ template: { id: template.id } });
}
