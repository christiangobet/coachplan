import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { clonePlanStructure, alignWeeksToRaceDate, alignWeeksToStartDate } from '@/lib/clone-plan';
import { ensureUserFromAuth } from '@/lib/user-sync';

type WeekDateAnchor = 'RACE_DATE' | 'START_DATE';

function parseDateInput(input: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false };
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d };
}

function parseWeekDateAnchor(input: unknown): { ok: true; value: WeekDateAnchor | null } | { ok: false } {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  if (input === 'RACE_DATE' || input === 'START_DATE') return { ok: true, value: input };
  return { ok: false };
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
  const parsedRaceDate = parseDateInput(body?.raceDate);
  if (!parsedRaceDate.ok) {
    return NextResponse.json({ error: 'raceDate must be an ISO date string or null' }, { status: 400 });
  }
  const parsedStartDate = parseDateInput(body?.startDate);
  if (!parsedStartDate.ok) {
    return NextResponse.json({ error: 'startDate must be an ISO date string or null' }, { status: 400 });
  }
  const parsedAnchor = parseWeekDateAnchor(body?.weekDateAnchor);
  if (!parsedAnchor.ok) {
    return NextResponse.json({ error: 'weekDateAnchor must be RACE_DATE or START_DATE' }, { status: 400 });
  }

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

  if (!template.isPublic && template.ownerId !== user.id) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  let weekDateAnchor = parsedAnchor.value;
  if (!weekDateAnchor) {
    if (parsedStartDate.value && !parsedRaceDate.value) weekDateAnchor = 'START_DATE';
    else weekDateAnchor = 'RACE_DATE';
  }

  const raceDate = parsedRaceDate.value || (weekDateAnchor === 'RACE_DATE' ? dbUser.goalRaceDate || null : null);
  const startDate = parsedStartDate.value;

  if (weekDateAnchor === 'RACE_DATE' && !raceDate) {
    return NextResponse.json({ error: 'Race date is required when weekDateAnchor is RACE_DATE' }, { status: 400 });
  }
  if (weekDateAnchor === 'START_DATE' && !startDate) {
    return NextResponse.json({ error: 'Start date is required when weekDateAnchor is START_DATE' }, { status: 400 });
  }

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
      ...(template.parseProfile !== null ? { parseProfile: template.parseProfile } : {}),
      ownerId: user.id,
      athleteId: user.id,
      sourceId: template.id,
    },
  });

  await clonePlanStructure(template, newPlan.id);

  // Ensure new plan starts clean — no completion state, no day status tags
  await prisma.planActivity.updateMany({
    where: { planId: newPlan.id },
    data: {
      completed: false,
      completedAt: null,
      actualDistance: null,
      actualDuration: null,
      actualPace: null,
    }
  });
  await prisma.planDay.updateMany({
    where: { planId: newPlan.id },
    data: { notes: null }
  });

  const totalWeeks = template.weeks.length || template.weekCount || 0;
  if (weekDateAnchor === 'START_DATE' && startDate && totalWeeks > 0) {
    await alignWeeksToStartDate(newPlan.id, totalWeeks, startDate);
  } else if (raceDate && totalWeeks > 0) {
    await alignWeeksToRaceDate(newPlan.id, totalWeeks, raceDate);
  } else {
    await prisma.planWeek.updateMany({
      where: { planId: newPlan.id },
      data: { startDate: null, endDate: null }
    });
  }

  return NextResponse.json({ planId: newPlan.id });
}
