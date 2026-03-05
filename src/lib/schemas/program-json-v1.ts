import { z } from 'zod';

// ── Steps inside a session (e.g. WarmUp / Interval / CoolDown) ───────────────
export type SessionStep = {
  type: 'warmup' | 'cooldown' | 'tempo' | 'interval' | 'recovery' | 'easy' | 'distance' | 'note' | 'repeat';
  repetitions?: number;      // 'repeat' only
  steps?: SessionStep[];     // 'repeat' only — child steps
  distance_miles?: number;
  distance_km?: number;
  duration_minutes?: number;
  pace_target?: string | null;
  effort?: string | null;
  description?: string;
};

export const SessionStepSchema: z.ZodType<SessionStep> = z.lazy(() =>
  z.object({
    type: z.preprocess(
      (v) => (typeof v === 'string' ? v.toLowerCase() : v),
      z.enum([
        'warmup', 'cooldown', 'tempo', 'interval', 'recovery',
        'easy', 'distance', 'note', 'repeat'
      ]).catch('note')
    ) as z.ZodType<SessionStep['type']>,
    repetitions: z.coerce.number().int().optional(),
    steps: z.array(SessionStepSchema).optional(),
    distance_miles: z.coerce.number().optional(),
    distance_km: z.coerce.number().optional(),
    duration_minutes: z.coerce.number().optional(),
    pace_target: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    description: z.string().optional(),
  })
);

// ── Individual training session ───────────────────────────────────────────────
export const SessionV1Schema = z.object({
  day_of_week: z
    .enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    .nullable()
    .optional()
    .catch(null), // silently coerce invalid values (e.g. "Total" column) to null

  session_role: z.string().nullable().optional(),

  activity_type: z.enum([
    'Run',
    'Walk',
    'CrossTraining',
    'Strength',
    'Rest',
    'Race',
    'Mobility',
    'Yoga',
    'Hike',
    'Other'
  ]).catch('Other'), // coerce unrecognised values (e.g. "Cross Training", "XT") to Other

  priority: z.boolean().optional().default(false),
  optional: z.boolean().optional().default(false),
  priority_level: z.enum(['KEY', 'MEDIUM', 'OPTIONAL']).nullable().optional(),

  distance_km: z.coerce.number().nullable().optional(),
  distance_miles: z.coerce.number().nullable().optional(),

  // V5 dual-distance: quality segment only vs. full session (incl. WU/CD)
  quality_distance_km: z.coerce.number().nullable().optional(),
  quality_distance_miles: z.coerce.number().nullable().optional(),
  total_distance_km: z.coerce.number().nullable().optional(),
  total_distance_miles: z.coerce.number().nullable().optional(),

  duration_minutes: z.coerce.number().int().nullable().optional(),
  duration_min_minutes: z.coerce.number().int().nullable().optional(),
  duration_max_minutes: z.coerce.number().int().nullable().optional(),

  intensity: z.string().nullable().optional(),

  steps: z.array(SessionStepSchema).optional().default([]),
  optional_alternatives: z.array(z.unknown()).optional().default([]),

  notes: z.string().nullable().optional(),
  raw_text: z.string().catch('')
});

export type SessionV1 = z.infer<typeof SessionV1Schema>;

// ── Training week ─────────────────────────────────────────────────────────────
export const WeekV1Schema = z.object({
  week_number: z.number().int().positive(),
  week_type: z
    .enum(['normal', 'cutback', 'taper', 'race'])
    .nullable()
    .optional()
    .catch(null),

  total_weekly_mileage_min: z.coerce.number().nullable().optional(),
  total_weekly_mileage_max: z.coerce.number().nullable().optional(),

  sessions: z.array(SessionV1Schema)
});

export type WeekV1 = z.infer<typeof WeekV1Schema>;

// ── Top-level program metadata ────────────────────────────────────────────────
export const ProgramMetaV1Schema = z.object({
  title: z.string().nullable().optional(),

  distance_target: z
    .enum(['5K', '10K', 'HALF', 'MARATHON', 'ULTRA'])
    .nullable()
    .optional(),

  plan_length_weeks: z.number().int().positive().nullable().optional(),

  layout_type: z
    .enum(['sequential_table', 'symbolic', 'calendar_grid', 'frequency_based'])
    .optional(),

  source_units: z.enum(['km', 'miles', 'mixed']).nullable().optional(),

  // Open objects — content varies by plan; stored as-is for admin inspection
  intensity_rules: z.record(z.string(), z.unknown()).optional().default({}),
  shared_protocols: z
    .object({
      warmup: z.string().nullable().optional(),
      cooldown: z.string().nullable().optional()
    })
    .optional(),
  training_rules: z.record(z.string(), z.unknown()).optional().default({}),
  phase_rules: z.array(z.unknown()).optional().default([]),
  progression: z.record(z.string(), z.unknown()).optional().default({}),
  symbol_dictionary: z.record(z.string(), z.string()).optional().default({}),
  glossary: z.record(z.string(), z.string()).optional().default({}),

  assumptions: z.array(z.string()).optional().default([]),
  program_notes: z.array(z.string()).optional().default([])
});

export type ProgramMetaV1 = z.infer<typeof ProgramMetaV1Schema>;

// ── Quality checks ────────────────────────────────────────────────────────────
export const QualityChecksV1Schema = z.object({
  weeks_detected: z.number().int().nonnegative(),
  missing_days: z.array(z.unknown()).optional().default([]),
  anomalies: z.array(z.unknown()).optional().default([])
});

export type QualityChecksV1 = z.infer<typeof QualityChecksV1Schema>;

// ── Root document ─────────────────────────────────────────────────────────────
export const ProgramJsonV1Schema = z.object({
  program: ProgramMetaV1Schema,
  weeks: z.array(WeekV1Schema),
  quality_checks: QualityChecksV1Schema
});

export type ProgramJsonV1 = z.infer<typeof ProgramJsonV1Schema>;
