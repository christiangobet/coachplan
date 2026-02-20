import { z } from 'zod';

// ── Steps inside a session (e.g. WarmUp / Interval / CoolDown) ───────────────
export const SessionStepSchema = z.record(z.string(), z.unknown());
export type SessionStep = z.infer<typeof SessionStepSchema>;

// ── Individual training session ───────────────────────────────────────────────
export const SessionV1Schema = z.object({
  day_of_week: z
    .enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    .nullable()
    .optional(),

  session_role: z.string().nullable().optional(),

  activity_type: z.enum([
    'Run',
    'Walk',
    'CrossTraining',
    'Strength',
    'Rest',
    'Race',
    'Other'
  ]),

  priority: z.boolean().optional().default(false),
  optional: z.boolean().optional().default(false),

  distance_km: z.number().nullable().optional(),
  distance_miles: z.number().nullable().optional(),
  duration_minutes: z.number().int().nullable().optional(),
  duration_min_minutes: z.number().int().nullable().optional(),
  duration_max_minutes: z.number().int().nullable().optional(),

  intensity: z.string().nullable().optional(),

  steps: z.array(SessionStepSchema).optional().default([]),
  optional_alternatives: z.array(z.unknown()).optional().default([]),

  notes: z.string().nullable().optional(),
  raw_text: z.string()
});

export type SessionV1 = z.infer<typeof SessionV1Schema>;

// ── Training week ─────────────────────────────────────────────────────────────
export const WeekV1Schema = z.object({
  week_number: z.number().int().positive(),
  week_type: z
    .enum(['normal', 'cutback', 'taper', 'race'])
    .nullable()
    .optional(),

  total_weekly_mileage_min: z.number().nullable().optional(),
  total_weekly_mileage_max: z.number().nullable().optional(),

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
