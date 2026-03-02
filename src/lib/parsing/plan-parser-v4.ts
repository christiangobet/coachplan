// Server-side only — calls AI APIs and DB.
import { openaiJsonSchema, getDefaultAiModel, JsonParseError } from '@/lib/openai';
import { FALLBACK_DEFAULT_PROMPT } from '@/lib/prompts/plan-parser/fallback-default-prompt';
import { ProgramJsonV1Schema, type ProgramJsonV1 } from '@/lib/schemas/program-json-v1';
import {
  buildWeekRanges,
  findMissingWeekNumbers,
  formatWeekRange,
  inferExpectedWeekCount,
  mergeWeeksFromPasses,
  splitWeekRange,
  type WeekRange
} from './v4-pass-strategy';

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
                    enum: ['Run', 'Walk', 'CrossTraining', 'Strength', 'Rest', 'Race', 'Mobility', 'Yoga', 'Hike', 'Other']
                  },
                  priority: { type: 'boolean' },
                  optional: { type: 'boolean' },
                  distance_km: { type: 'number' },
                  distance_miles: { type: 'number' },
                  duration_minutes: { type: 'integer' },
                  duration_min_minutes: { type: 'integer' },
                  duration_max_minutes: { type: 'integer' },
                  intensity: { type: 'string' },
                  steps: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['type'],
                      properties: {
                        type: { type: 'string', enum: ['WarmUp', 'CoolDown', 'Interval', 'Tempo', 'Easy', 'Distance', 'Note'] },
                        repeat: { type: 'integer' },
                        duration_minutes: { type: 'number' },
                        distance_km: { type: 'number' },
                        distance_miles: { type: 'number' },
                        pace_target: { type: ['string', 'null'] },
                        effort: { type: ['string', 'null'] },
                        description: { type: 'string' }
                      }
                    }
                  },
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

function buildInput(
  promptText: string,
  fullText: string,
  weekRange?: string,
  planLengthWeeks?: number,
  planGuide?: string
): string {
  // Soft advisory — used only for logging; does NOT truncate.
  const textTruncated = fullText.length > TEXT_LIMIT;

  const rangeInstruction = weekRange
    ? [
        `\nIMPORTANT: Output ONLY weeks ${weekRange} in the "weeks" array. Skip all other weeks.`,
        planLengthWeeks
          ? `The plan has ${planLengthWeeks} weeks total — do not invent weeks beyond this.`
          : ''
      ].filter(Boolean).join(' ') + '\n'
    : '';

  const guideSection = planGuide
    ? `\nPLAN CONTEXT GUIDE (use to resolve abbreviations and understand session types):\n${planGuide}\n`
    : '';

  return [
    promptText,
    guideSection,
    rangeInstruction,
    textTruncated
      ? `Raw plan text (full text, ${fullText.length} characters):`
      : 'Raw plan text:',
    fullText   // ← full text, no slice
  ]
    .filter(Boolean)
    .join('\n');
}

async function runSinglePass(
  fullText: string,
  model: string,
  promptText: string,
  weekRange?: string,
  planLengthWeeks?: number,
  planGuide?: string
): Promise<ParserV4Result> {
  const input = buildInput(promptText, fullText, weekRange, planLengthWeeks, planGuide);

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
 * Attempts a single-pass parse; if truncated, falls back to chunked
 * week-range passes and merges successful results.
 * Returns the structured result (validated or not) — never throws.
 *
 * @param promptText  Optional prompt text override. Falls back to V4_MASTER_PROMPT constant.
 */
export async function runParserV4(
  fullText: string,
  promptText?: string,
  planLengthWeeks?: number,
  planGuide?: string
): Promise<ParserV4Result> {
  const model = getDefaultAiModel();
  const resolvedPrompt = promptText ?? FALLBACK_DEFAULT_PROMPT;

  const textTruncated = fullText.length > TEXT_LIMIT;
  console.info('[ParserV4] Input text', {
    totalChars: fullText.length,
    sentChars: Math.min(fullText.length, TEXT_LIMIT),
    truncated: textTruncated
  });

  // ── Pass 1: try parsing everything in one shot ──────────────────────────────
  const single = await runSinglePass(fullText, model, resolvedPrompt, undefined, planLengthWeeks, planGuide);

  if (!single.truncated) {
    return single;
  }

  // ── Multi-pass fallback (strict 5-week chunks + targeted retries) ──────────
  // Single-pass truncates for verbose prompts; strict chunking keeps each call bounded.
  const maxWeek = planLengthWeeks ? planLengthWeeks + 2 : 25; // +2 buffer for taper/race
  const initialRanges = buildWeekRanges(maxWeek, 5);
  console.info('[ParserV4] Single pass truncated — falling back to chunked passes', {
    ranges: initialRanges.map((range) => formatWeekRange(range))
  });

  const initialPasses = await Promise.all(
    initialRanges.map(async (range) => ({
      range,
      result: await runSinglePass(fullText, model, resolvedPrompt, formatWeekRange(range), planLengthWeeks, planGuide)
    }))
  );

  const successfulPasses: Array<{ range: WeekRange; data: ProgramJsonV1 }> = initialPasses
    .filter((pass) => !pass.result.truncated && pass.result.data)
    .map((pass) => ({ range: pass.range, data: pass.result.data! }));

  if (successfulPasses.length === 0) {
    console.error('[ParserV4] All chunked passes failed — returning single-pass artifact');
    return single;
  }

  const failedInitialRanges = initialPasses
    .filter((pass) => pass.result.truncated || !pass.result.data)
    .map((pass) => pass.range);

  if (failedInitialRanges.length > 0) {
    const retryRanges = failedInitialRanges.flatMap((range) => splitWeekRange(range, 3));
    console.warn('[ParserV4] Some chunked passes failed — retrying in smaller ranges', {
      failedRanges: failedInitialRanges.map((range) => formatWeekRange(range)),
      retryRanges: retryRanges.map((range) => formatWeekRange(range))
    });

    const retryPasses = await Promise.all(
      retryRanges.map(async (range) => ({
        range,
        result: await runSinglePass(fullText, model, resolvedPrompt, formatWeekRange(range), planLengthWeeks, planGuide)
      }))
    );

    const retrySuccesses = retryPasses
      .filter((pass) => !pass.result.truncated && pass.result.data)
      .map((pass) => ({ range: pass.range, data: pass.result.data! }));
    successfulPasses.push(...retrySuccesses);
  }

  const mergedWeeks = mergeWeeksFromPasses(successfulPasses.map((pass) => ({ data: pass.data })));
  const expectedWeeks = inferExpectedWeekCount(successfulPasses, mergedWeeks);
  const missingWeeks = findMissingWeekNumbers(mergedWeeks, expectedWeeks);
  const isLikelyComplete = expectedWeeks <= 0 || missingWeeks.length === 0;

  // Use program metadata from the earliest successful pass
  const firstSuccess = successfulPasses[0].data;

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
  // Accept partial results — missing weeks are surfaced as a warning, not a hard failure.
  // Schema must pass; completeness is advisory.
  const validated = validation.success;

  console.info('[ParserV4] Chunked merge complete', {
    initialRanges: initialRanges.length,
    successfulPasses: successfulPasses.length,
    totalWeeks: mergedWeeks.length,
    expectedWeeks,
    missingWeeks: missingWeeks.length,
    validated,
    complete: isLikelyComplete
  });

  return {
    parserVersion: PARSER_VERSION,
    model,
    validated,
    data: validated ? validation.data! : null,
    rawJson: merged,
    validationError: validated
      ? (missingWeeks.length > 0
          ? `Parsed ${mergedWeeks.length}/${expectedWeeks} weeks — missing: ${missingWeeks.join(', ')}`
          : null)
      : validation.error.message,
    truncated: !isLikelyComplete,
    threePass: true
  };
}
