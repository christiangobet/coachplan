/**
 * Converts a validated ProgramJsonV1 (Parser V4 output) into the plan's
 * TrainingWeek / PlanDay / PlanActivity DB records.
 *
 * Server-side only. Safe to call after V4 returns validated === true.
 */
import { prisma } from '@/lib/prisma';
import { ActivityType } from '@prisma/client';
import type { ProgramJsonV1 } from '@/lib/schemas/program-json-v1';
import { withParserPipelineProfile, type MdParseStatus, type ParserPersistenceSource, type ProgramDocumentProfile } from '@/lib/plan-document-profile';
import {
  buildActivityDraftFromSession,
  derivePlanDayNotes,
} from './v4-persistence-mapping';
import { buildProgramWeekCompletenessWarning } from './program-week-completeness';

const DOW_MAP: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7
};

/**
 * Writes V4 parsed plan data into the DB for the given planId.
 * Assumes the plan record already exists (created before parsing).
 * Creates PlanWeek, PlanDay, and PlanActivity rows.
 */
export async function populatePlanFromV4(
  planId: string,
  data: ProgramJsonV1,
  options?: {
    parserPipeline?: {
      persistenceSource: ParserPersistenceSource;
      mdParseStatus: MdParseStatus;
      extractedMdAttempted?: boolean;
    };
  },
): Promise<{ weeksCreated: number; activitiesCreated: number }> {
  const completenessWarning = buildProgramWeekCompletenessWarning(data);
  if (completenessWarning) {
    throw new Error(completenessWarning.message);
  }

  const sourceUnits = data.program?.source_units;
  const sortedWeeks = [...data.weeks].sort((a, b) => a.week_number - b.week_number);

  let activitiesCreated = 0;

  for (const week of sortedWeeks) {
    const planWeek = await prisma.planWeek.create({
      data: {
        planId,
        weekIndex: week.week_number,
        coachBrief: week.week_brief ?? null,
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
      const dayNotes = derivePlanDayNotes(sessions);

      const planDay = await prisma.planDay.create({
        data: {
          planId,
          weekId: planWeek.id,
          dayOfWeek: dow,
          rawText,
          notes: dayNotes,
        }
      });

      const activityRows = sessions
        .filter((s) => s.activity_type !== 'Rest')
        .map((session) => buildActivityDraftFromSession({
          planId,
          dayId: planDay.id,
          sourceUnits,
          session,
        }));

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
  const persistedProfile = options?.parserPipeline
    ? withParserPipelineProfile(parseProfile, {
      persistence_source: options.parserPipeline.persistenceSource,
      md_parse_status: options.parserPipeline.mdParseStatus,
      extracted_md_attempted: options.parserPipeline.extractedMdAttempted ?? true,
    })
    : parseProfile;

  // Update plan metadata from V4 program object
  await prisma.trainingPlan.update({
    where: { id: planId },
    data: {
      weekCount: sortedWeeks.length,
      parseProfile: persistedProfile,
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
