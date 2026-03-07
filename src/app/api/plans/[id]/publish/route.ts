import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { assignSessionGroups } from '@/lib/assign-session-groups';
import { alignWeeksToRaceDate, alignWeeksToStartDate } from '@/lib/clone-plan';

type WeekDateAnchor = 'RACE_DATE' | 'START_DATE';

function parseDateInput(input: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false };
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  return { ok: true, value: parsed };
}

function parseWeekDateAnchor(input: unknown): { ok: true; value: WeekDateAnchor | null } | { ok: false } {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  if (input === 'RACE_DATE' || input === 'START_DATE') return { ok: true, value: input };
  return { ok: false };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
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

  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      athleteId: true,
      raceDate: true,
      weekCount: true
    }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const raceDate = parsedRaceDate.value ?? plan.raceDate ?? null;
  const startDate = parsedStartDate.value ?? null;
  let weekDateAnchor = parsedAnchor.value;
  if (!weekDateAnchor) {
    if (startDate && !raceDate) weekDateAnchor = 'START_DATE';
    else if (raceDate) weekDateAnchor = 'RACE_DATE';
  }

  if (weekDateAnchor === 'RACE_DATE' && !raceDate) {
    return NextResponse.json(
      { error: 'Activation requires raceDate for RACE_DATE scheduling mode.' },
      { status: 400 }
    );
  }
  if (weekDateAnchor === 'START_DATE' && !startDate) {
    return NextResponse.json(
      { error: 'Activation requires startDate for START_DATE scheduling mode.' },
      { status: 400 }
    );
  }
  if (!weekDateAnchor) {
    return NextResponse.json(
      { error: 'Activation requires scheduling: provide raceDate or startDate with weekDateAnchor.' },
      { status: 400 }
    );
  }

  // Auto-group multi-run days before activating
  await assignSessionGroups(plan.id).catch((err) =>
    console.error('[publish] assignSessionGroups failed:', err)
  );

  const totalWeeks = plan.weekCount || await prisma.planWeek.count({ where: { planId: plan.id } });
  if (totalWeeks > 0) {
    if (weekDateAnchor === 'START_DATE' && startDate) {
      await alignWeeksToStartDate(plan.id, totalWeeks, startDate);
    } else if (weekDateAnchor === 'RACE_DATE' && raceDate) {
      await alignWeeksToRaceDate(plan.id, totalWeeks, raceDate);
    }
  }

  const updated = await prisma.trainingPlan.update({
    where: { id: plan.id },
    data: { status: 'ACTIVE', raceDate: raceDate }
  });

  const runActivityCount = await prisma.planActivity.count({
    where: { planId: plan.id, type: 'RUN' }
  });

  return NextResponse.json({ plan: updated, runActivityCount });
}
