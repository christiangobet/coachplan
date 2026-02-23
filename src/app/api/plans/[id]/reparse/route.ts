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
export const maxDuration = 300;

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
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: planId } = await params;

  // ── Load plan with weeks, days, activities ────────────────────────────────
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    include: {
      weeks: {
        orderBy: { weekIndex: 'asc' },
        include: {
          days: {
            orderBy: { dayOfWeek: 'asc' },
            include: {
              activities: {
                orderBy: { id: 'asc' }
              }
            }
          }
        }
      },
    }
  });

  if (!plan) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (plan.ownerId !== userId && plan.athleteId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const planGuide = plan.planGuide ?? undefined;

  // ── Task 03.3 & 03.4: Re-run parseWeekWithAI per week, merge results ──────
  let weeksProcessed = 0;
  let activitiesUpdated = 0;
  const weekErrors: Array<{ weekIndex: number; error: string }> = [];

  for (const week of plan.weeks) {
    // Build days input: dayName -> rawText (or empty string)
    const days: Record<string, string> = {};
    for (const key of DAY_KEYS) {
      days[key] = '';
    }
    for (const day of week.days) {
      const key = DAY_KEYS[day.dayOfWeek - 1] ?? null;
      if (key) {
        days[key] = day.rawText ?? '';
      }
    }

    // Re-run parse for this week
    let parsedWeek: Awaited<ReturnType<typeof parseWeekWithAI>>;
    try {
      parsedWeek = await parseWeekWithAI({
        planName: plan.name,
        weekNumber: week.weekIndex,
        days,
        planGuide
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reparse] Week ${week.weekIndex} parse failed (non-fatal)`, {
        planId,
        weekId: week.id,
        error: message
      });
      weekErrors.push({ weekIndex: week.weekIndex, error: message });
      continue;
    }

    // Merge parsed activities into existing activities per day
    for (const day of week.days) {
      const key = DAY_KEYS[day.dayOfWeek - 1] ?? null;
      if (!key) continue;

      const parsedDay = parsedWeek.days?.[key];
      const parsedActivities = parsedDay?.activities ?? [];
      const existingActivities = day.activities;

      // Match by position (index). Skip if no existing activities.
      if (existingActivities.length === 0 || parsedActivities.length === 0) {
        continue;
      }

      const updatePromises: Promise<unknown>[] = [];

      for (let i = 0; i < Math.min(parsedActivities.length, existingActivities.length); i++) {
        const parsed = parsedActivities[i];
        const existing = existingActivities[i];

        // Resolve paceTarget from parsed metrics / target_intensity
        const rawPaceText =
          parsed.metrics?.pace_target ??
          (parsed.target_intensity?.type === 'pace' ? parsed.target_intensity.value : null) ??
          null;
        const paceTarget = rawPaceText ? extractPaceTargetFromText(rawPaceText) : null;

        // Resolve effortTarget
        const rawEffortText =
          parsed.metrics?.effort_target ??
          (parsed.target_intensity?.type !== 'pace' && parsed.target_intensity?.value
            ? parsed.target_intensity.value
            : null) ??
          null;
        const effortTarget = rawEffortText ? extractEffortTargetFromText(rawEffortText) : null;

        // Derive structured targets (pace + effort fields)
        const structuredTargets = deriveStructuredIntensityTargets({
          paceTarget: paceTarget ?? undefined,
          effortTarget: effortTarget ?? undefined
        });

        // Build the update payload — never touch athlete-owned fields
        const mappedType = parsed.type ? PARSED_TYPE_MAP[parsed.type as string] : undefined;
        const updateData: {
          type?: ActivityType;
          title?: string;
          rawText?: string | null;
          sessionInstructions?: string | null;
          paceTarget?: string | null;
          effortTarget?: string | null;
          paceTargetMode?: typeof structuredTargets.paceTargetMode;
          paceTargetBucket?: typeof structuredTargets.paceTargetBucket;
          paceTargetMinSec?: typeof structuredTargets.paceTargetMinSec;
          paceTargetMaxSec?: typeof structuredTargets.paceTargetMaxSec;
          paceTargetUnit?: typeof structuredTargets.paceTargetUnit;
          effortTargetType?: typeof structuredTargets.effortTargetType;
          effortTargetMin?: typeof structuredTargets.effortTargetMin;
          effortTargetMax?: typeof structuredTargets.effortTargetMax;
          effortTargetZone?: typeof structuredTargets.effortTargetZone;
          effortTargetBpmMin?: typeof structuredTargets.effortTargetBpmMin;
          effortTargetBpmMax?: typeof structuredTargets.effortTargetBpmMax;
        } = {};

        if (mappedType) updateData.type = mappedType;
        if (parsed.title && parsed.title.trim()) {
          updateData.title = parsed.title.trim();
        }
        if (parsed.raw_text && parsed.raw_text.trim()) {
          updateData.rawText = parsed.raw_text.trim();
        }

        updateData.sessionInstructions = parsed.instruction_text ?? null;
        updateData.paceTarget = paceTarget;
        updateData.effortTarget = effortTarget;

        // Spread structured intensity target fields
        updateData.paceTargetMode = structuredTargets.paceTargetMode;
        updateData.paceTargetBucket = structuredTargets.paceTargetBucket;
        updateData.paceTargetMinSec = structuredTargets.paceTargetMinSec;
        updateData.paceTargetMaxSec = structuredTargets.paceTargetMaxSec;
        updateData.paceTargetUnit = structuredTargets.paceTargetUnit;
        updateData.effortTargetType = structuredTargets.effortTargetType;
        updateData.effortTargetMin = structuredTargets.effortTargetMin;
        updateData.effortTargetMax = structuredTargets.effortTargetMax;
        updateData.effortTargetZone = structuredTargets.effortTargetZone;
        updateData.effortTargetBpmMin = structuredTargets.effortTargetBpmMin;
        updateData.effortTargetBpmMax = structuredTargets.effortTargetBpmMax;

        updatePromises.push(
          prisma.planActivity.update({
            where: { id: existing.id },
            data: updateData
          })
        );
        activitiesUpdated++;
      }

      await Promise.all(updatePromises);
    }

    weeksProcessed++;
  }

  // ── Task 03.5: Return summary ─────────────────────────────────────────────
  if (weekErrors.length > 0) {
    return NextResponse.json(
      {
        weeksProcessed,
        weeksFailed: weekErrors.length,
        activitiesUpdated,
        planId,
        weekErrors
      },
      { status: 207 }
    );
  }

  return NextResponse.json({
    weeksProcessed,
    weeksFailed: 0,
    activitiesUpdated,
    planId
  });
}
