// Server-side only — calls AI APIs and DB.
import { openaiJsonSchema, getDefaultAiModel, JsonParseError } from '@/lib/openai';
import { V4_MASTER_PROMPT } from '@/lib/prompts/plan-parser/v4_master';
import { ProgramJsonV1Schema, type ProgramJsonV1 } from '@/lib/schemas/program-json-v1';

const PARSER_VERSION = 'v4';
const TEXT_LIMIT = 40000;

/**
 * JSON Schema sent to the AI response_format.
 * Must stay aligned with ProgramJsonV1Schema and v4_master.ts.
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
                // Only activity_type and raw_text are truly required.
                // priority/optional default to false when absent — omit them to save tokens.
                required: ['activity_type', 'raw_text'],
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
                  distance_km: { type: 'number' },
                  distance_miles: { type: 'number' },
                  duration_minutes: { type: 'integer' },
                  duration_min_minutes: { type: 'integer' },
                  duration_max_minutes: { type: 'integer' },
                  intensity: { type: 'string' },
                  steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  optional_alternatives: { type: 'array', items: {} },
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
  truncated?: boolean;
  twoPass?: boolean;
  threePass?: boolean;
};

function buildInput(promptText: string, fullText: string, weekRange?: string): string {
  const textTruncated = fullText.length > TEXT_LIMIT;

  const rangeInstruction = weekRange
    ? `\nIMPORTANT: Output ONLY weeks ${weekRange} in the "weeks" array. Skip all other weeks.\n`
    : '';

  return [
    promptText,
    rangeInstruction,
    textTruncated
      ? `Raw plan text (first ${TEXT_LIMIT} of ${fullText.length} characters):`
      : 'Raw plan text:',
    fullText.slice(0, TEXT_LIMIT)
  ]
    .filter(Boolean)
    .join('\n');
}

async function runSinglePass(
  fullText: string,
  model: string,
  promptText: string,
  weekRange?: string
): Promise<ParserV4Result> {
  const input = buildInput(promptText, fullText, weekRange);

  let rawJson: unknown;
  try {
    rawJson = await openaiJsonSchema<unknown>({
      input,
      schema: PROGRAM_JSON_V1_SCHEMA,
      model,
      maxOutputTokens: 16384
    });
  } catch (err) {
    if (err instanceof JsonParseError) {
      return {
        parserVersion: PARSER_VERSION,
        model,
        validated: false,
        data: null,
        rawJson: { _truncated: true, rawText: err.rawText.slice(0, 20000) },
        validationError: 'Response was not valid JSON — raw text saved as artifact',
        truncated: true
      };
    }
    throw err;
  }

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

/**
 * Run Parser V4 on extracted PDF text.
 * Attempts a single-pass parse; if truncated, falls back to two parallel
 * passes (weeks 1–8 and weeks 9–16) and merges the results.
 * Returns the structured result (validated or not) — never throws.
 *
 * @param promptText  Optional prompt text override. Falls back to V4_MASTER_PROMPT constant.
 */
export async function runParserV4(fullText: string, promptText?: string): Promise<ParserV4Result> {
  const model = getDefaultAiModel();
  const resolvedPrompt = promptText ?? V4_MASTER_PROMPT;

  const textTruncated = fullText.length > TEXT_LIMIT;
  console.info('[ParserV4] Input text', {
    totalChars: fullText.length,
    sentChars: Math.min(fullText.length, TEXT_LIMIT),
    truncated: textTruncated
  });

  // ── Pass 1: try parsing everything in one shot ──────────────────────────────
  const single = await runSinglePass(fullText, model, resolvedPrompt);

  if (!single.truncated) {
    return single;
  }

  // ── Multi-pass fallback (4 parallel passes, 5-week chunks) ─────────────────
  // Single-pass truncates at ~5 weeks for verbose prompts (v5+).
  // 5-week chunks give a safe margin; 4 passes cover plans up to 22 weeks.
  console.info('[ParserV4] Single pass truncated — falling back to four-pass (wks 1-5, 6-10, 11-15, 16-22)');

  const [p1, p2, p3, p4] = await Promise.all([
    runSinglePass(fullText, model, resolvedPrompt, '1 through 5'),
    runSinglePass(fullText, model, resolvedPrompt, '6 through 10'),
    runSinglePass(fullText, model, resolvedPrompt, '11 through 15'),
    runSinglePass(fullText, model, resolvedPrompt, '16 through 22')
  ]);

  const passes = [p1, p2, p3, p4];
  const successfulPasses = passes.filter((p) => !p.truncated && p.data);

  if (successfulPasses.length === 0) {
    console.error('[ParserV4] All four passes truncated — returning single-pass artifact');
    return single;
  }

  if (successfulPasses.length < passes.length) {
    const failedRanges = [
      !p1.data && '1-5',
      !p2.data && '6-10',
      !p3.data && '11-15',
      !p4.data && '16-22'
    ].filter(Boolean);
    console.warn('[ParserV4] Some passes failed — merging successful passes only', { failedRanges });
  }

  // Merge weeks from all successful passes, deduplicate by week_number, sort
  const weekMap = new Map<number, ProgramJsonV1['weeks'][number]>();
  for (const pass of successfulPasses) {
    for (const week of pass.data!.weeks) {
      weekMap.set(week.week_number, week);
    }
  }
  const mergedWeeks = [...weekMap.values()].sort((a, b) => a.week_number - b.week_number);

  // Use program metadata from the earliest successful pass
  const firstSuccess = successfulPasses[0].data!;

  const merged: ProgramJsonV1 = {
    program: firstSuccess.program,
    weeks: mergedWeeks,
    quality_checks: {
      weeks_detected: mergedWeeks.length,
      missing_days: [],
      anomalies: []
    }
  };

  const validation = ProgramJsonV1Schema.safeParse(merged);

  console.info('[ParserV4] Four-pass merge complete', {
    weeksPass1: p1.data?.weeks.length ?? 0,
    weeksPass2: p2.data?.weeks.length ?? 0,
    weeksPass3: p3.data?.weeks.length ?? 0,
    weeksPass4: p4.data?.weeks.length ?? 0,
    totalWeeks: mergedWeeks.length,
    validated: validation.success
  });

  return {
    parserVersion: PARSER_VERSION,
    model,
    validated: validation.success,
    data: validation.success ? validation.data : null,
    rawJson: merged,
    validationError: validation.success ? null : validation.error.message,
    threePass: true
  };
}
