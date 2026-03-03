import { z } from 'zod';

// ── Survey JSON produced by the V5 Phase 1 call ──────────────────────────────
export const SurveyPlanStructureSchema = z.object({
  layout_type: z.enum(['sequential_table', 'calendar_grid', 'symbolic', 'frequency_based']),
  plan_length_weeks: z.number().int().positive(),
  training_days_per_week: z.number().int().nonnegative().nullable().optional(),
  source_units: z.enum(['km', 'miles', 'mixed']).nullable().optional(),
  distance_target: z.enum(['5K', '10K', 'HALF', 'MARATHON', 'ULTRA']).nullable().optional(),
  long_run_day: z.string().nullable().optional(),
  anchor_days: z.record(z.string(), z.string()).nullable().optional(),
  rest_pattern: z.string().nullable().optional(),
  day_of_week_inferred: z.boolean().optional()
});

export type SurveyPlanStructure = z.infer<typeof SurveyPlanStructureSchema>;

export const SurveyJsonV1Schema = z.object({
  plan_structure: SurveyPlanStructureSchema,
  glossary: z.record(z.string(), z.string()).optional().default({}),
  intensity_zones: z.record(z.string(), z.string()).optional().default({}),
  coaching_notes: z.array(z.string()).optional().default([])
});

export type SurveyJsonV1 = z.infer<typeof SurveyJsonV1Schema>;

// ── Compact JSON Schema for OpenAI structured output ─────────────────────────
export const SURVEY_JSON_SCHEMA = {
  name: 'survey_json_v1',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_structure'],
    properties: {
      plan_structure: {
        type: 'object',
        additionalProperties: false,
        required: ['layout_type', 'plan_length_weeks'],
        properties: {
          layout_type: {
            type: 'string',
            enum: ['sequential_table', 'calendar_grid', 'symbolic', 'frequency_based']
          },
          plan_length_weeks: { type: 'integer' },
          training_days_per_week: { type: ['integer', 'null'] },
          source_units: { type: ['string', 'null'], enum: ['km', 'miles', 'mixed', null] },
          distance_target: { type: ['string', 'null'], enum: ['5K', '10K', 'HALF', 'MARATHON', 'ULTRA', null] },
          long_run_day: { type: ['string', 'null'] },
          anchor_days: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
          rest_pattern: { type: ['string', 'null'] },
          day_of_week_inferred: { type: 'boolean' }
        }
      },
      glossary: { type: 'object', additionalProperties: { type: 'string' } },
      intensity_zones: { type: 'object', additionalProperties: { type: 'string' } },
      coaching_notes: { type: 'array', items: { type: 'string' } }
    }
  }
};
