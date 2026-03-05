// Server-side only — calls AI APIs and DB.
import { openaiJsonSchema, getDefaultAiModel, JsonParseError } from '@/lib/openai';
import { type ProgramJsonV1 } from '@/lib/schemas/program-json-v1';
import { V5_SURVEY_PROMPT } from '@/lib/prompts/plan-parser/v5-survey-prompt';
import { SURVEY_JSON_SCHEMA, SurveyJsonV1Schema, type SurveyJsonV1 } from './v5-survey-schema';
import { runParserV4 } from './plan-parser-v4';

const PARSER_VERSION = 'v5';

export type ParserV5Result = {
  parserVersion: typeof PARSER_VERSION;
  model: string;
  validated: boolean;
  data: ProgramJsonV1 | null;
  rawJson: unknown;
  validationError: string | null;
  survey: SurveyJsonV1 | null;
  truncated?: boolean;
  twoPass?: boolean;
  threePass?: boolean;
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

// ── Main orchestrator ─────────────────────────────────────────────────────────
export async function runParserV5(
  fullText: string,
  promptText?: string,
  planLengthHint?: number
): Promise<ParserV5Result> {
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
      survey: null
    };
  }

  const planLengthWeeks = survey.plan_structure.plan_length_weeks ?? planLengthHint;
  const surveyContextJson = JSON.stringify(survey);

  console.info('[ParserV5] Survey complete', {
    layout: survey.plan_structure.layout_type,
    weeks: planLengthWeeks,
    glossaryTerms: Object.keys(survey.glossary ?? {}).length
  });

  // Phase 2: V4 extraction enriched with survey context as planGuide
  const v4Result = await runParserV4(fullText, promptText, planLengthWeeks, surveyContextJson);

  console.info('[ParserV5] V4 extraction complete', {
    validated: v4Result.validated,
    weeks: v4Result.data?.weeks.length ?? 0,
    truncated: v4Result.truncated,
    threePass: v4Result.threePass
  });

  return {
    parserVersion: PARSER_VERSION,
    model: v4Result.model,
    validated: v4Result.validated,
    data: v4Result.data,
    rawJson: v4Result.rawJson,
    validationError: v4Result.validationError,
    survey,
    truncated: v4Result.truncated,
    twoPass: v4Result.twoPass,
    threePass: v4Result.threePass
  };
}
