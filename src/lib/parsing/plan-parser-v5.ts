// Server-side only — calls AI APIs and DB.
import { openaiJsonSchema, getDefaultAiModel, JsonParseError } from '@/lib/openai';
import { ProgramJsonV1Schema, type ProgramJsonV1 } from '@/lib/schemas/program-json-v1';
import { V5_SURVEY_PROMPT } from '@/lib/prompts/plan-parser/v5-survey-prompt';
import { buildWeekInput } from '@/lib/prompts/plan-parser/v5-week-prompt';
import { SURVEY_JSON_SCHEMA, SurveyJsonV1Schema, type SurveyJsonV1 } from './v5-survey-schema';

const PARSER_VERSION = 'v5';

// ── JSON schema for a single extracted week ───────────────────────────────────
const WEEK_JSON_SCHEMA = {
  name: 'week_json_v5',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['week_number', 'sessions'],
    properties: {
      week_number: { type: 'integer' },
      not_found: { type: 'boolean' },
      week_type: { type: ['string', 'null'], enum: ['normal', 'cutback', 'taper', 'race', null] },
      total_weekly_mileage_min: { type: ['number', 'null'] },
      total_weekly_mileage_max: { type: ['number', 'null'] },
      sessions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['activity_type', 'raw_text'],
          properties: {
            day_of_week: { type: ['string', 'null'], enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', null] },
            session_role: { type: ['string', 'null'] },
            activity_type: {
              type: 'string',
              enum: ['Run', 'Walk', 'CrossTraining', 'Strength', 'Rest', 'Race', 'Mobility', 'Yoga', 'Hike', 'Other']
            },
            priority: { type: 'boolean' },
            optional: { type: 'boolean' },
            priority_level: { type: ['string', 'null'], enum: ['KEY', 'MEDIUM', 'OPTIONAL', null] },
            distance_km: { type: ['number', 'null'] },
            distance_miles: { type: ['number', 'null'] },
            quality_distance_km: { type: ['number', 'null'] },
            quality_distance_miles: { type: ['number', 'null'] },
            total_distance_km: { type: ['number', 'null'] },
            total_distance_miles: { type: ['number', 'null'] },
            duration_minutes: { type: ['integer', 'null'] },
            duration_min_minutes: { type: ['integer', 'null'] },
            duration_max_minutes: { type: ['integer', 'null'] },
            intensity: { type: ['string', 'null'] },
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
            notes: { type: ['string', 'null'] },
            raw_text: { type: 'string' }
          }
        }
      }
    }
  }
};

export type ParserV5Result = {
  parserVersion: typeof PARSER_VERSION;
  model: string;
  validated: boolean;
  data: ProgramJsonV1 | null;
  rawJson: unknown;
  validationError: string | null;
  survey: SurveyJsonV1 | null;
  weeksExtracted: number;
  weeksMissing: number[];
  missingWeekRetries: number;
};

// ── Phase 1: Survey call ──────────────────────────────────────────────────────
async function runSurveyCall(fullText: string, model: string): Promise<SurveyJsonV1 | null> {
  const input = [V5_SURVEY_PROMPT, '', 'Training plan text:', fullText].join('\n');

  let rawJson: unknown;
  try {
    rawJson = await openaiJsonSchema<unknown>({
      input,
      schema: SURVEY_JSON_SCHEMA,
      model,
      maxOutputTokens: 2048
    });
  } catch (err) {
    if (err instanceof JsonParseError) {
      console.error('[ParserV5] Survey call JSON parse error');
      return null;
    }
    throw err;
  }

  const parsed = SurveyJsonV1Schema.safeParse(rawJson);
  if (!parsed.success) {
    console.error('[ParserV5] Survey validation failed', parsed.error.message);
    return null;
  }
  return parsed.data;
}

// ── Phase 2: Single week extraction call ─────────────────────────────────────
type RawWeek = {
  week_number: number;
  not_found?: boolean;
  sessions: ProgramJsonV1['weeks'][number]['sessions'];
  week_type?: string | null;
  total_weekly_mileage_min?: number | null;
  total_weekly_mileage_max?: number | null;
};

async function extractWeek(
  weekNumber: number,
  surveyJson: string,
  fullText: string,
  model: string
): Promise<RawWeek | null> {
  const input = buildWeekInput(weekNumber, surveyJson, fullText);

  let rawJson: unknown;
  try {
    rawJson = await openaiJsonSchema<unknown>({
      input,
      schema: WEEK_JSON_SCHEMA,
      model,
      maxOutputTokens: 4096
    });
  } catch (err) {
    if (err instanceof JsonParseError) {
      console.warn(`[ParserV5] Week ${weekNumber} JSON parse error — skipping`);
      return null;
    }
    throw err;
  }

  const raw = rawJson as RawWeek;
  if (!raw || typeof raw.week_number !== 'number') return null;
  if (raw.not_found) {
    console.info(`[ParserV5] Week ${weekNumber} not found in PDF`);
    return { week_number: weekNumber, sessions: [], not_found: true };
  }
  return raw;
}

// ── Merge raw weeks into ProgramJsonV1 ───────────────────────────────────────
function mergeIntoProgram(
  survey: SurveyJsonV1,
  weeks: RawWeek[]
): ProgramJsonV1 {
  const sortedWeeks = [...weeks]
    .filter((w) => !w.not_found && w.sessions.length > 0)
    .sort((a, b) => a.week_number - b.week_number);

  return {
    program: {
      title: null,
      distance_target: survey.plan_structure.distance_target ?? null,
      plan_length_weeks: survey.plan_structure.plan_length_weeks,
      layout_type: survey.plan_structure.layout_type,
      source_units: survey.plan_structure.source_units ?? null,
      glossary: survey.glossary ?? {},
      intensity_rules: survey.intensity_zones ?? {},
      training_rules: {},
      phase_rules: [],
      progression: {},
      symbol_dictionary: {},
      assumptions: [],
      program_notes: survey.coaching_notes ?? []
    },
    weeks: sortedWeeks.map((w) => ({
      week_number: w.week_number,
      week_type: (w.week_type as ProgramJsonV1['weeks'][number]['week_type']) ?? null,
      total_weekly_mileage_min: w.total_weekly_mileage_min ?? null,
      total_weekly_mileage_max: w.total_weekly_mileage_max ?? null,
      sessions: w.sessions
    })),
    quality_checks: {
      weeks_detected: sortedWeeks.length,
      missing_days: [],
      anomalies: []
    }
  };
}

// ── Validate quality ──────────────────────────────────────────────────────────
function scoreV5Result(data: ProgramJsonV1): number {
  if (!data.weeks.length) return 0;
  const sessionsWithSteps = data.weeks
    .flatMap((w) => w.sessions)
    .filter((s) => s.steps && s.steps.length > 0).length;
  const totalSessions = data.weeks.flatMap((w) => w.sessions).length;
  const stepRate = totalSessions > 0 ? sessionsWithSteps / totalSessions : 0;
  // Base 50 for having weeks + up to 50 for step coverage
  return Math.round(50 + stepRate * 50);
}

// ── Main orchestrator ─────────────────────────────────────────────────────────
export async function runParserV5(fullText: string): Promise<ParserV5Result> {
  const model = getDefaultAiModel();

  console.info('[ParserV5] Starting — survey call');

  // Phase 1: Survey
  const survey = await runSurveyCall(fullText, model);
  if (!survey) {
    return {
      parserVersion: PARSER_VERSION,
      model,
      validated: false,
      data: null,
      rawJson: null,
      validationError: 'Survey call failed — could not determine plan structure',
      survey: null,
      weeksExtracted: 0,
      weeksMissing: [],
      missingWeekRetries: 0
    };
  }

  const planLengthWeeks = survey.plan_structure.plan_length_weeks;
  const surveyJson = JSON.stringify(survey);

  console.info('[ParserV5] Survey complete', {
    layout: survey.plan_structure.layout_type,
    weeks: planLengthWeeks,
    glossaryTerms: Object.keys(survey.glossary ?? {}).length
  });

  // Phase 2: Parallel week extraction
  const weekNumbers = Array.from({ length: planLengthWeeks }, (_, i) => i + 1);

  console.info('[ParserV5] Launching parallel week extraction', { weeks: planLengthWeeks });

  const weekResults = await Promise.all(
    weekNumbers.map((n) => extractWeek(n, surveyJson, fullText, model))
  );

  const extractedWeeks: RawWeek[] = weekResults.filter((w): w is RawWeek => w !== null);

  // Phase 3: Identify missing weeks and retry
  const extractedNumbers = new Set(extractedWeeks.filter((w) => !w.not_found).map((w) => w.week_number));
  const initialMissing = weekNumbers.filter((n) => !extractedNumbers.has(n));

  let retryCount = 0;
  if (initialMissing.length > 0) {
    console.warn('[ParserV5] Missing weeks after first pass — retrying', { missing: initialMissing });

    const retryResults = await Promise.all(
      initialMissing.map((n) => extractWeek(n, surveyJson, fullText, model))
    );

    for (const retryWeek of retryResults) {
      if (retryWeek && !retryWeek.not_found && retryWeek.sessions.length > 0) {
        extractedWeeks.push(retryWeek);
        extractedNumbers.add(retryWeek.week_number);
        retryCount++;
      }
    }
  }

  const finalMissing = weekNumbers.filter((n) => !extractedNumbers.has(n));

  // Build merged program
  const merged = mergeIntoProgram(survey, extractedWeeks);

  // Validate against schema
  const validation = ProgramJsonV1Schema.safeParse(merged);
  const validated = validation.success;

  const qualityScore = validated ? scoreV5Result(validation.data!) : 0;

  console.info('[ParserV5] Complete', {
    planLengthWeeks,
    weeksExtracted: extractedNumbers.size,
    weeksMissing: finalMissing,
    retryCount,
    validated,
    qualityScore
  });

  const validationError = validated
    ? (finalMissing.length > 0 ? `Parsed ${extractedNumbers.size}/${planLengthWeeks} weeks — missing: ${finalMissing.join(', ')}` : null)
    : validation.error.message;

  return {
    parserVersion: PARSER_VERSION,
    model,
    validated,
    data: validated ? validation.data! : null,
    rawJson: merged,
    validationError,
    survey,
    weeksExtracted: extractedNumbers.size,
    weeksMissing: finalMissing,
    missingWeekRetries: retryCount
  };
}
