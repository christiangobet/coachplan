/**
 * Converts a validated ProgramJsonV1 (Parser V4 output) into the plan's
 * TrainingWeek / PlanDay / PlanActivity DB records.
 *
 * Server-side only. Safe to call after V4 returns validated === true.
 */
import { prisma } from '@/lib/prisma';
import { ActivityType, ActivityPriority, Units, Prisma } from '@prisma/client';
import type { ProgramJsonV1, SessionStep } from '@/lib/schemas/program-json-v1';
import type { ProgramDocumentProfile } from '@/lib/plan-document-profile';
import {
  deriveStructuredIntensityTargets,
  extractEffortTargetFromText,
  extractPaceTargetFromText
} from '@/lib/intensity-targets';

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
  Mobility: ActivityType.MOBILITY,
  Yoga: ActivityType.YOGA,
  Hike: ActivityType.HIKE,
  Other: ActivityType.OTHER
};

function formatStepsAsInstructions(steps: SessionStep[], indent = ''): string | null {
  if (!steps || steps.length === 0) return null;
  const lines: string[] = [];
  for (const step of steps) {
    if (step.type === 'repeat') {
      const inner = formatStepsAsInstructions(step.steps || [], '  ');
      lines.push(`${indent}${step.repetitions || 2}×`);
      if (inner) inner.split('\n').forEach(l => lines.push(`  ${l}`));
    } else {
      const parts: string[] = [];
      switch (step.type) {
        case 'warmup':   parts.push('Warm-up'); break;
        case 'cooldown': parts.push('Cool-down'); break;
        case 'interval': parts.push('Interval'); break;
        case 'tempo':    parts.push('Tempo'); break;
        case 'recovery': parts.push('Recovery'); break;
        case 'easy':     parts.push('Easy'); break;
        case 'distance': parts.push('Run'); break;
        case 'note':     lines.push(step.description ?? ''); continue;
      }
      if (step.distance_miles) parts.push(`${step.distance_miles} mi`);
      else if (step.distance_km) parts.push(`${step.distance_km} km`);
      if (step.duration_minutes) parts.push(`${step.duration_minutes} min`);
      if (step.pace_target) parts.push(`@ ${step.pace_target}`);
      if (step.effort) parts.push(`(${step.effort})`);
      lines.push(`${indent}${parts.join(' ')}`);
    }
  }
  return lines.filter(Boolean).join('\n') || null;
}

function computeTotalDistanceMiles(steps: SessionStep[]): number | null {
  if (!steps?.length) return null;
  let total = 0; let hasAny = false;
  for (const step of steps) {
    if (step.type === 'repeat') {
      const inner = computeTotalDistanceMiles(step.steps || []);
      if (inner != null) { total += inner * (step.repetitions || 1); hasAny = true; }
    } else {
      const d = step.distance_miles ?? (step.distance_km ? step.distance_km / 1.60934 : null);
      if (d != null) { total += d; hasAny = true; }
    }
  }
  return hasAny ? Math.round(total * 100) / 100 : null;
}

function deriveTitle(session: ProgramJsonV1['weeks'][number]['sessions'][number]): string {
  if (session.session_role) return session.session_role;
  switch (session.activity_type) {
    case 'Run': return 'Run';
    case 'Walk': return 'Walk';
    case 'CrossTraining': return 'Cross Training';
    case 'Strength': return 'Strength';
    case 'Rest': return 'Rest';
    case 'Race': return 'Race';
    case 'Mobility': return 'Mobility';
    case 'Yoga': return 'Yoga';
    case 'Hike': return 'Hike';
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
          const paceTarget = extractPaceTargetFromText(session.intensity || session.raw_text || null);
          const effortTarget = session.intensity
            ? (extractEffortTargetFromText(session.intensity) || session.intensity || null)
            : extractEffortTargetFromText(session.raw_text || null);
          const structuredTargets = deriveStructuredIntensityTargets({
            paceTarget,
            effortTarget,
            fallbackUnit: distanceUnit
          });

          const priorityLevel = (() => {
            if (session.priority_level === 'KEY')      return ActivityPriority.KEY;
            if (session.priority_level === 'MEDIUM')   return ActivityPriority.MEDIUM;
            if (session.priority_level === 'OPTIONAL') return ActivityPriority.OPTIONAL;
            // fallback from legacy bool fields
            if (session.priority === true)  return ActivityPriority.KEY;
            if (session.optional === true)  return ActivityPriority.OPTIONAL;
            return ActivityPriority.MEDIUM;
          })();

          const stepsInstructions = session.steps && session.steps.length > 0
            ? formatStepsAsInstructions(session.steps as SessionStep[])
            : (session.instruction_text || null);

          const stepsStructure = session.steps?.length ? session.steps : null;

          // Use parser-provided distance if available, else compute from steps
          const computedTotal = (!session.distance_miles && !session.distance_km && stepsStructure)
            ? computeTotalDistanceMiles(session.steps as SessionStep[])
            : null;

          return {
            planId,
            dayId: planDay.id,
            type: activityType,
            subtype: session.activity_type === 'Race' ? 'race' : null,
            title,
            rawText: session.raw_text || null,
            sessionInstructions: stepsInstructions,
            distance: computedTotal != null && distance == null ? computedTotal : distance,
            distanceUnit: computedTotal != null && distance == null ? Units.MILES : distanceUnit,
            duration,
            paceTarget,
            effortTarget,
            ...structuredTargets,
            priority: priorityLevel,
            mustDo: priorityLevel === ActivityPriority.KEY,
            bailAllowed: priorityLevel === ActivityPriority.OPTIONAL,
            structure: stepsStructure ?? Prisma.JsonNull
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

  // Derive parseProfile from V4 data so the review page profile card shows correctly
  const parseProfile = buildProfileFromV4(data, sortedWeeks);

  // Update plan metadata from V4 program object
  await prisma.trainingPlan.update({
    where: { id: planId },
    data: {
      weekCount: sortedWeeks.length,
      parseProfile,
      status: 'DRAFT'
    }
  });

  return { weeksCreated: sortedWeeks.length, activitiesCreated };
}

function buildProfileFromV4(
  data: ProgramJsonV1,
  sortedWeeks: ProgramJsonV1['weeks']
): ProgramDocumentProfile {
  const meta = data.program;
  const planLengthWeeks = meta?.plan_length_weeks ?? sortedWeeks.length;

  // days_per_week: median unique training days per week (max 7)
  const sessionCountsPerWeek = sortedWeeks.map((w) => {
    const activeDays = new Set(
      (w.sessions || [])
        .filter((s) => s.activity_type !== 'Rest' && s.day_of_week)
        .map((s) => s.day_of_week)
    );
    return activeDays.size;
  });
  const sorted = [...sessionCountsPerWeek].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const daysPerWeek = sorted.length ? (sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]) : 0;

  // units
  const srcUnits = meta?.source_units;
  const units: ProgramDocumentProfile['units'] = srcUnits === 'km' ? 'km' : srcUnits === 'miles' ? 'miles' : 'unknown';

  // distance_type
  const distTarget = meta?.distance_target;
  const distanceTypeMap: Record<string, ProgramDocumentProfile['distance_type']> = {
    '5K': '5K', '10K': '10K', 'HALF': 'HALF', 'MARATHON': 'MARATHON', 'ULTRA': 'BASE'
  };
  const distanceType: ProgramDocumentProfile['distance_type'] = distTarget ? (distanceTypeMap[distTarget] ?? 'CUSTOM') : 'UNKNOWN';

  // intensity_model: scan intensity strings
  let hasPace = false, hasHr = false, hasRpe = false;
  for (const week of sortedWeeks) {
    for (const session of week.sessions || []) {
      const txt = (session.intensity || session.raw_text || '').toLowerCase();
      if (/\d+:\d{2}/.test(txt) || /min\/km|min\/mi|pace/.test(txt)) hasPace = true;
      if (/\d+\s*bpm|hr|heart rate|%\s*max/.test(txt)) hasHr = true;
      if (/rpe|effort|easy|moderate|hard|zone/.test(txt)) hasRpe = true;
    }
  }
  const intensityModel: ProgramDocumentProfile['intensity_model'] =
    hasPace && hasHr ? 'hybrid' : hasPace ? 'pace' : hasHr ? 'hr' : hasRpe ? 'rpe' : 'unknown';

  // quality flags
  let hasIntervals = false, hasTempo = false, hasHills = false, hasStrides = false, hasStrength = false, hasCrossTraining = false;
  for (const week of sortedWeeks) {
    for (const session of week.sessions || []) {
      const txt = (session.session_role || session.raw_text || session.intensity || '').toLowerCase();
      if (/interval|repeat|rep/.test(txt)) hasIntervals = true;
      if (/tempo|threshold/.test(txt)) hasTempo = true;
      if (/hill|incline/.test(txt)) hasHills = true;
      if (/stride/.test(txt)) hasStrides = true;
      if (session.activity_type === 'Strength') hasStrength = true;
      if (session.activity_type === 'CrossTraining') hasCrossTraining = true;
    }
  }

  // peak week km & taper
  const weeklyKm = sortedWeeks.map((w) =>
    (w.sessions || []).reduce((sum, s) => sum + (s.distance_km ?? (s.distance_miles ? s.distance_miles * 1.60934 : 0)), 0)
  );
  const peakWeekKm = weeklyKm.length ? Math.max(...weeklyKm) : null;
  const peakLongRunKm = (() => {
    let max = 0;
    for (const week of sortedWeeks) {
      for (const s of week.sessions || []) {
        const km = s.distance_km ?? (s.distance_miles ? s.distance_miles * 1.60934 : 0);
        if (km > max) max = km;
      }
    }
    return max || null;
  })();
  const taperWeeks = sortedWeeks.filter((w) => w.week_type === 'taper').length || null;

  // structure_tags
  const structureTags: string[] = [];
  if (sortedWeeks.some((w) => w.week_type === 'cutback')) structureTags.push('cutback_weeks');
  if (taperWeeks) structureTags.push('taper');
  if (distTarget === 'MARATHON') structureTags.push('marathon');
  else if (distTarget === 'HALF') structureTags.push('half_marathon');

  return {
    plan_length_weeks: planLengthWeeks ?? sortedWeeks.length,
    days_per_week: Math.min(Math.round(daysPerWeek), 7),
    distance_type: distanceType,
    intensity_model: intensityModel,
    units,
    language_hint: 'en',
    includes_quality: {
      intervals: hasIntervals,
      tempo: hasTempo,
      hills: hasHills,
      strides: hasStrides,
      strength: hasStrength,
      cross_training: hasCrossTraining
    },
    peak_week_km: peakWeekKm && peakWeekKm > 0 ? Math.round(peakWeekKm * 10) / 10 : null,
    peak_long_run_km: peakLongRunKm && peakLongRunKm > 0 ? Math.round(peakLongRunKm * 10) / 10 : null,
    taper_weeks: taperWeeks,
    structure_tags: structureTags
  };
}
