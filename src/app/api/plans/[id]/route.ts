import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';

function parseRaceDateInput(input: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (input === null || input === '') {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false };
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

async function appendSourcePlanName<T extends { sourceId?: string | null }>(plan: T) {
  if (!plan.sourceId) {
    return { ...plan, sourcePlanName: null };
  }
  const sourcePlan = await prisma.trainingPlan.findUnique({
    where: { id: plan.sourceId },
    select: { name: true }
  });
  return { ...plan, sourcePlanName: sourcePlan?.name || null };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const viewerUnits = profile?.units === 'KM' ? 'KM' : 'MILES';

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ plan: await appendSourcePlanName(plan), viewerUnits });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const viewerUnits = profile?.units === 'KM' ? 'KM' : 'MILES';

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const existingPlan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      weekCount: true
    }
  });
  if (!existingPlan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existingPlan.ownerId !== user.id && existingPlan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updates: {
    raceName?: string | null;
    raceDate?: Date | null;
  } = {};

  if ('raceName' in body) {
    if (body.raceName !== null && typeof body.raceName !== 'string') {
      return NextResponse.json({ error: 'raceName must be a string or null' }, { status: 400 });
    }
    const raceName = typeof body.raceName === 'string' ? body.raceName.trim() : '';
    updates.raceName = raceName || null;
  }

  let raceDatePatched = false;
  if ('raceDate' in body) {
    const parsedRaceDate = parseRaceDateInput(body.raceDate);
    if (!parsedRaceDate.ok) {
      return NextResponse.json({ error: 'raceDate must be an ISO date string or null' }, { status: 400 });
    }
    raceDatePatched = true;
    updates.raceDate = parsedRaceDate.value;
  }

  if (!('raceName' in body) && !('raceDate' in body)) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
  }

  const plan = await prisma.trainingPlan.update({
    where: { id },
    data: updates,
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });

  if (raceDatePatched) {
    const totalWeeks = existingPlan.weekCount || plan.weeks.length;
    if (updates.raceDate && totalWeeks > 0) {
      await alignWeeksToRaceDate(plan.id, totalWeeks, updates.raceDate);
    } else {
      await prisma.planWeek.updateMany({
        where: { planId: plan.id },
        data: { startDate: null, endDate: null }
      });
    }
  }

  const refreshed = await prisma.trainingPlan.findUnique({
    where: { id: plan.id },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });

  if (!refreshed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ plan: await appendSourcePlanName(refreshed), viewerUnits });
}
