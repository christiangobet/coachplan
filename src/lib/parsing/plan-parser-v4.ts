// Server-side only — calls AI APIs and DB.
import { openaiJsonSchema, getDefaultAiModel } from '@/lib/openai';
import { V4_MASTER_PROMPT } from '@/lib/prompts/plan-parser/v4_master';
import { ProgramJsonV1Schema, type ProgramJsonV1 } from '@/lib/schemas/program-json-v1';

const PARSER_VERSION = 'v4';

/**
 * JSON Schema sent to the AI response_format.
 * Must stay aligned with ProgramJsonV1Schema and v4_master.txt.
 */
const PROGRAM_JSON_V1_SCHEMA = {
  name: 'program_json_v1',
  // strict: false because the program object contains open-ended fields
  // (intensity_rules, training_rules, progression, etc.) that require
  // additionalProperties: true — incompatible with OpenAI strict mode.
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['program', 'weeks', 'quality_checks'],
    properties: {
      program: {
        type: 'object',
        additionalProperties: true,
        required: ['title', 'distance_target', 'plan_length_weeks', 'layout_type', 'source_units'],
        properties: {
          title: { type: ['string', 'null'] },
          distance_target: {
            type: ['string', 'null'],
            enum: ['5K', '10K', 'HALF', 'MARATHON', 'ULTRA', null]
          },
          plan_length_weeks: { type: ['integer', 'null'] },
          layout_type: {
            type: 'string',
            enum: ['sequential_table', 'symbolic', 'calendar_grid', 'frequency_based']
          },
          source_units: {
            type: ['string', 'null'],
            enum: ['km', 'miles', 'mixed', null]
          },
          intensity_rules: { type: 'object', additionalProperties: true },
          shared_protocols: {
            type: 'object',
            additionalProperties: false,
            properties: {
              warmup: { type: ['string', 'null'] },
              cooldown: { type: ['string', 'null'] }
            }
          },
          training_rules: { type: 'object', additionalProperties: true },
          phase_rules: { type: 'array', items: {} },
          progression: { type: 'object', additionalProperties: true },
          symbol_dictionary: { type: 'object', additionalProperties: { type: 'string' } },
          glossary: { type: 'object', additionalProperties: { type: 'string' } },
          assumptions: { type: 'array', items: { type: 'string' } },
          program_notes: { type: 'array', items: { type: 'string' } }
        }
      },
      weeks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['week_number', 'sessions'],
          properties: {
            week_number: { type: 'integer' },
            week_type: {
              type: ['string', 'null'],
              enum: ['normal', 'cutback', 'taper', 'race', null]
            },
            total_weekly_mileage_min: { type: ['number', 'null'] },
            total_weekly_mileage_max: { type: ['number', 'null'] },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['activity_type', 'priority', 'optional', 'raw_text'],
                properties: {
                  day_of_week: {
                    type: ['string', 'null'],
                    enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', null]
                  },
                  session_role: { type: ['string', 'null'] },
                  activity_type: {
                    type: 'string',
                    enum: ['Run', 'Walk', 'CrossTraining', 'Strength', 'Rest', 'Race', 'Other']
                  },
                  priority: { type: 'boolean' },
                  optional: { type: 'boolean' },
                  distance_km: { type: ['number', 'null'] },
                  distance_miles: { type: ['number', 'null'] },
                  duration_minutes: { type: ['integer', 'null'] },
                  duration_min_minutes: { type: ['integer', 'null'] },
                  duration_max_minutes: { type: ['integer', 'null'] },
                  intensity: { type: ['string', 'null'] },
                  steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  optional_alternatives: { type: 'array', items: {} },
                  notes: { type: ['string', 'null'] },
                  raw_text: { type: 'string' }
                }
              }
            }
          }
        }
      },
      quality_checks: {
        type: 'object',
        additionalProperties: false,
        required: ['weeks_detected'],
        properties: {
          weeks_detected: { type: 'integer' },
          missing_days: { type: 'array', items: {} },
          anomalies: { type: 'array', items: {} }
        }
      }
    }
  }
};

export type ParserV4Result = {
  parserVersion: typeof PARSER_VERSION;
  model: string;
  validated: boolean;
  data: ProgramJsonV1 | null;
  rawJson: unknown;
  validationError: string | null;
};

/**
 * Run Parser V4 on extracted PDF text.
 * Returns the structured result (validated or not) — never throws.
 */
export async function runParserV4(fullText: string): Promise<ParserV4Result> {
  const model = getDefaultAiModel();

  const input = [
    V4_MASTER_PROMPT,
    '',
    'Raw plan text (truncated to first 25000 characters if longer):',
    fullText.slice(0, 25000)
  ].join('\n');

  const rawJson = await openaiJsonSchema<unknown>({
    input,
    schema: PROGRAM_JSON_V1_SCHEMA,
    model
  });

  const parseResult = ProgramJsonV1Schema.safeParse(rawJson);

  if (parseResult.success) {
    return {
      parserVersion: PARSER_VERSION,
      model,
      validated: true,
      data: parseResult.data,
      rawJson,
      validationError: null
    };
  }

  return {
    parserVersion: PARSER_VERSION,
    model,
    validated: false,
    data: null,
    rawJson,
    validationError: parseResult.error.message
  };
}
