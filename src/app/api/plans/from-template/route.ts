import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { clonePlanStructure, alignWeeksToRaceDate } from '@/lib/clone-plan';
import { ensureUserFromAuth } from '@/lib/user-sync';

function parseRaceDate(input: unknown): Date | null {
  if (!input || typeof input !== 'string') return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await ensureUserFromAuth(user, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  const body = await req.json();
  const templateId = body?.templateId as string;
  const explicitRaceDate = parseRaceDate(body?.raceDate);

  if (!templateId) {
    return NextResponse.json({ error: 'templateId required' }, { status: 400 });
  }

  const template = await prisma.trainingPlan.findUnique({
    where: { id: templateId, isTemplate: true },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
    },
  });

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const raceDate = explicitRaceDate || dbUser.goalRaceDate || null;

  const newPlan = await prisma.trainingPlan.create({
    data: {
      name: template.name,
      raceName: template.raceName,
      description: template.description,
      isTemplate: false,
      status: 'ACTIVE',
      weekCount: template.weekCount,
      raceDate,
      raceType: template.raceType,
      difficulty: template.difficulty,
      ownerId: user.id,
      athleteId: user.id,
      sourceId: template.id,
    },
  });

  await clonePlanStructure(template, newPlan.id);

  const totalWeeks = template.weeks.length || template.weekCount || 0;
  if (raceDate && totalWeeks > 0) {
    await alignWeeksToRaceDate(newPlan.id, totalWeeks, raceDate);
  } else {
    await prisma.planWeek.updateMany({
      where: { planId: newPlan.id },
      data: { startDate: null, endDate: null }
    });
  }

  return NextResponse.json({ planId: newPlan.id });
}
