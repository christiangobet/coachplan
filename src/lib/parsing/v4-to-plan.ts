/**
 * Converts a validated ProgramJsonV1 (Parser V4 output) into the plan's
 * TrainingWeek / PlanDay / PlanActivity DB records.
 *
 * Server-side only. Safe to call after V4 returns validated === true.
 */
import { prisma } from '@/lib/prisma';
import { ActivityType, Units } from '@prisma/client';
import type { ProgramJsonV1 } from '@/lib/schemas/program-json-v1';

const DOW_MAP: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7
};

const ACTIVITY_TYPE_MAP: Record<string, ActivityType> = {
  Run: ActivityType.RUN,
  Walk: ActivityType.OTHER,
  CrossTraining: ActivityType.CROSS_TRAIN,
  Strength: ActivityType.STRENGTH,
  Rest: ActivityType.REST,
  Race: ActivityType.RUN,
  Other: ActivityType.OTHER
};

function deriveTitle(session: ProgramJsonV1['weeks'][number]['sessions'][number]): string {
  if (session.session_role) return session.session_role;
  switch (session.activity_type) {
    case 'Run': return 'Run';
    case 'Walk': return 'Walk';
    case 'CrossTraining': return 'Cross Training';
    case 'Strength': return 'Strength';
    case 'Rest': return 'Rest';
    case 'Race': return 'Race';
    default: return 'Workout';
  }
}

function resolveDistance(
  session: ProgramJsonV1['weeks'][number]['sessions'][number],
  sourceUnits: string | null | undefined
): { distance: number | null; distanceUnit: Units | null } {
  const preferMiles = sourceUnits === 'miles' || (!session.distance_km && session.distance_miles);
  const preferKm = sourceUnits === 'km' || (!session.distance_miles && session.distance_km);

  if (preferMiles && session.distance_miles != null) {
    return { distance: session.distance_miles, distanceUnit: Units.MILES };
  }
  if (preferKm && session.distance_km != null) {
    return { distance: session.distance_km, distanceUnit: Units.KM };
  }
  if (session.distance_miles != null) {
    return { distance: session.distance_miles, distanceUnit: Units.MILES };
  }
  if (session.distance_km != null) {
    return { distance: session.distance_km, distanceUnit: Units.KM };
  }
  return { distance: null, distanceUnit: null };
}

/**
 * Writes V4 parsed plan data into the DB for the given planId.
 * Assumes the plan record already exists (created before parsing).
 * Creates PlanWeek, PlanDay, and PlanActivity rows.
 */
export async function populatePlanFromV4(
  planId: string,
  data: ProgramJsonV1
): Promise<{ weeksCreated: number; activitiesCreated: number }> {
  const sourceUnits = data.program?.source_units;
  const sortedWeeks = [...data.weeks].sort((a, b) => a.week_number - b.week_number);

  let activitiesCreated = 0;

  for (const week of sortedWeeks) {
    const planWeek = await prisma.planWeek.create({
      data: {
        planId,
        weekIndex: week.week_number
      }
    });

    // Group sessions by day_of_week (skip sessions with null day_of_week)
    const byDay = new Map<number, typeof week.sessions>();
    for (const session of week.sessions || []) {
      if (!session.day_of_week) continue;
      const dow = DOW_MAP[session.day_of_week];
      if (!dow) continue;
      const existing = byDay.get(dow) || [];
      existing.push(session);
      byDay.set(dow, existing);
    }

    for (const [dow, sessions] of byDay.entries()) {
      const rawText = sessions.map((s) => s.raw_text).filter(Boolean).join(' | ') || null;

      const planDay = await prisma.planDay.create({
        data: {
          planId,
          weekId: planWeek.id,
          dayOfWeek: dow,
          rawText
        }
      });

      const activityRows = sessions
        .filter((s) => s.activity_type !== 'Rest')
        .map((session) => {
          const { distance, distanceUnit } = resolveDistance(session, sourceUnits);
          const activityType = ACTIVITY_TYPE_MAP[session.activity_type] || ActivityType.OTHER;
          const title = deriveTitle(session);
          const duration = session.duration_minutes ?? null;

          return {
            planId,
            dayId: planDay.id,
            type: activityType,
            subtype: session.activity_type === 'Race' ? 'race' : null,
            title,
            rawText: session.raw_text || null,
            distance,
            distanceUnit,
            duration,
            paceTarget: null,
            effortTarget: session.intensity || null,
            mustDo: session.priority === true,
            bailAllowed: session.optional === true
          };
        });

      if (activityRows.length > 0) {
        await prisma.planActivity.createMany({ data: activityRows });
        activitiesCreated += activityRows.length;
      } else {
        // Rest day: create a Rest activity so the day is visible in the review
        await prisma.planActivity.create({
          data: {
            planId,
            dayId: planDay.id,
            type: 'REST',
            title: 'Rest',
            rawText: sessions[0]?.raw_text || null,
            mustDo: false,
            bailAllowed: false
          }
        });
        activitiesCreated += 1;
      }
    }
  }

  // Update plan metadata from V4 program object
  await prisma.trainingPlan.update({
    where: { id: planId },
    data: {
      weekCount: sortedWeeks.length,
      status: 'DRAFT'
    }
  });

  return { weeksCreated: sortedWeeks.length, activitiesCreated };
}
