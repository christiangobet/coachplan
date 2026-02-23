import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ActivityType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseWeekWithAI } from '@/lib/ai-plan-parser';
import {
  extractPaceTargetFromText,
  extractEffortTargetFromText,
  deriveStructuredIntensityTargets
} from '@/lib/intensity-targets';

// Maps WEEK_SCHEMA lowercase types → Prisma ActivityType enum
const PARSED_TYPE_MAP: Record<string, ActivityType> = {
  run: ActivityType.RUN,
  strength: ActivityType.STRENGTH,
  cross_train: ActivityType.CROSS_TRAIN,
  rest: ActivityType.REST,
  mobility: ActivityType.MOBILITY,
  yoga: ActivityType.YOGA,
  hike: ActivityType.HIKE,
  other: ActivityType.OTHER
};

export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: planId } = await params;

    const body = await req.json().catch(() => null);
    const weekIndex = typeof body?.weekIndex === 'number' ? body.weekIndex : null;
    const dayOfWeek = typeof body?.dayOfWeek === 'number' ? body.dayOfWeek : null;

    if (weekIndex === null || dayOfWeek === null) {
      return NextResponse.json({ error: 'weekIndex and dayOfWeek are required' }, { status: 400 });
    }

    // Load plan + the specific week + all days in that week (for context)
    const plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      include: {
        weeks: {
          where: { weekIndex },
          include: {
            days: {
              orderBy: { dayOfWeek: 'asc' },
              include: { activities: { orderBy: { id: 'asc' } } }
            }
          }
        }
      }
    });

    if (!plan) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (plan.ownerId !== userId && plan.athleteId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const week = plan.weeks[0];
    if (!week) {
      return NextResponse.json({ error: `Week ${weekIndex} not found` }, { status: 404 });
    }

    const targetDay = week.days.find((d) => d.dayOfWeek === dayOfWeek);
    if (!targetDay) {
      return NextResponse.json({ error: `Day ${dayOfWeek} not found in week ${weekIndex}` }, { status: 404 });
    }

    if (!targetDay.rawText?.trim()) {
      return NextResponse.json(
        { error: 'No source text found for this day — re-check requires stored day text.' },
        { status: 422 }
      );
    }

    // Build full-week days input: target day gets its rawText, others are empty
    // This keeps week context but focuses the AI on the single day
    const days: Record<string, string> = {};
    for (const key of DAY_KEYS) {
      days[key] = '';
    }
    for (const d of week.days) {
      const key = DAY_KEYS[d.dayOfWeek - 1] ?? null;
      if (key) days[key] = d.rawText ?? '';
    }

    const planGuide = plan.planGuide ?? undefined;

    let parsedWeek: Awaited<ReturnType<typeof parseWeekWithAI>>;
    try {
      parsedWeek = await parseWeekWithAI({
        planName: plan.name,
        weekNumber: weekIndex,
        days,
        planGuide
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `AI parse failed: ${message}` }, { status: 502 });
    }

    const targetDayKey = DAY_KEYS[dayOfWeek - 1];
    const parsedDay = parsedWeek.days?.[targetDayKey];
    const parsedActivities = parsedDay?.activities ?? [];
    const existingActivities = targetDay.activities;

    if (parsedActivities.length === 0 || existingActivities.length === 0) {
      return NextResponse.json({ activitiesUpdated: 0, dayId: targetDay.id });
    }

    const updatePromises: Promise<unknown>[] = [];
    let activitiesUpdated = 0;

    for (let i = 0; i < Math.min(parsedActivities.length, existingActivities.length); i++) {
      const parsed = parsedActivities[i];
      const existing = existingActivities[i];

      const rawPaceText =
        parsed.metrics?.pace_target ??
        (parsed.target_intensity?.type === 'pace' ? parsed.target_intensity.value : null) ??
        null;
      const paceTarget = rawPaceText ? extractPaceTargetFromText(rawPaceText) : null;

      const rawEffortText =
        parsed.metrics?.effort_target ??
        (parsed.target_intensity?.type !== 'pace' && parsed.target_intensity?.value
          ? parsed.target_intensity.value
          : null) ??
        null;
      const effortTarget = rawEffortText ? extractEffortTargetFromText(rawEffortText) : null;

      const structuredTargets = deriveStructuredIntensityTargets({
        paceTarget: paceTarget ?? undefined,
        effortTarget: effortTarget ?? undefined
      });

      const mappedType = parsed.type ? PARSED_TYPE_MAP[parsed.type as string] : undefined;

      const updateData: Record<string, unknown> = {
        sessionInstructions: parsed.instruction_text ?? null,
        paceTarget,
        effortTarget,
        ...structuredTargets
      };

      if (mappedType) updateData.type = mappedType;
      if (parsed.title?.trim()) updateData.title = parsed.title.trim();
      if (parsed.raw_text?.trim()) updateData.rawText = parsed.raw_text.trim();

      updatePromises.push(
        prisma.planActivity.update({ where: { id: existing.id }, data: updateData })
      );
      activitiesUpdated++;
    }

    await Promise.all(updatePromises);

    // Return the fresh day data so the UI can update without a full reload
    const refreshedDay = await prisma.planDay.findUnique({
      where: { id: targetDay.id },
      include: { activities: { orderBy: { id: 'asc' } } }
    });

    return NextResponse.json({ activitiesUpdated, dayId: targetDay.id, day: refreshedDay });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[reparse-day] Error:', message);
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
  }
}
