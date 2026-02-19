import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { alignWeeksToRaceDate, clonePlanStructure } from '@/lib/clone-plan';
import { requireRoleApi } from '@/lib/role-guards';

function parseRaceDate(input: unknown): Date | null {
  if (!input || typeof input !== 'string') return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseRaceName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return value || null;
}

export async function POST(req: Request) {
  const access = await requireRoleApi('COACH');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await req.json();
  const templateId = body?.templateId as string;
  const athleteId = (body?.athleteId as string) || access.context.userId;
  const explicitRaceDate = parseRaceDate(body?.raceDate);
  const explicitRaceName = parseRaceName(body?.raceName);
  if (!templateId) {
    return NextResponse.json({ error: 'templateId required' }, { status: 400 });
  }

  const template = await prisma.trainingPlan.findUnique({
    where: { id: templateId },
    include: {
      weeks: { include: { days: { include: { activities: true } } } }
    }
  });
  if (!template || !template.isTemplate) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const athlete = await prisma.user.findUnique({
    where: { id: athleteId },
    select: { goalRaceDate: true }
  });
  const resolvedRaceDate = explicitRaceDate || athlete?.goalRaceDate || null;

  const newPlan = await prisma.trainingPlan.create({
    data: {
      name: template.name,
      raceName: explicitRaceName || template.raceName,
      isTemplate: false,
      status: 'ACTIVE',
      weekCount: template.weekCount,
      raceDate: resolvedRaceDate,
      raceType: template.raceType,
      difficulty: template.difficulty,
      ...(template.parseProfile !== null ? { parseProfile: template.parseProfile } : {}),
      ownerId: access.context.userId,
      athleteId,
      sourceId: template.id,
    }
  });

  await clonePlanStructure(template, newPlan.id);

  const totalWeeks = template.weeks.length || template.weekCount || 0;
  if (resolvedRaceDate && totalWeeks > 0) {
    await alignWeeksToRaceDate(newPlan.id, totalWeeks, resolvedRaceDate);
  } else {
    await prisma.planWeek.updateMany({
      where: { planId: newPlan.id },
      data: { startDate: null, endDate: null }
    });
  }

  return NextResponse.json({ assigned: true, planId: newPlan.id });
}
