import { getDefaultAiModel, openaiJsonSchema } from "./openai";
import type { ProgramDocumentProfile } from "./plan-document-profile";
import { FLAGS } from "./feature-flags";
import { extractPdfText } from "./pdf/extract-text";
import { runParserV4 } from "./parsing/plan-parser-v4";
import { runParserV5 } from "./parsing/plan-parser-v5";
import { parsePlanLengthFromGuide, mergeWeeksFromPasses } from "./parsing/v4-pass-strategy";
import {
  createParseJob,
  updateParseJobStatus,
  saveParseArtifact
} from "./parsing/parse-artifacts";
import { prisma } from "./prisma";
import { extractPlanMd } from "./pdf/pdf-to-md";
import { chunkMd } from "./parsing/md-chunker";
import { alignProgramWeeksToExpectedChunk } from "./parsing/v4-week-alignment";
import { runVisionMdChunkWithRetries } from "./parsing/vision-md-retry";
import { MD_PARSER_PROMPT } from "./prompts/plan-parser/md-parser-prompt";
import { ProgramJsonV1Schema, type ProgramJsonV1 } from "./schemas/program-json-v1";

const WEEK_SCHEMA = {
  name: "week_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["week_number", "days"],
    properties: {
      week_number: { type: "integer" },
      days: {
        type: "object",
        additionalProperties: false,
        required: [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ],
        properties: {
          monday: { $ref: "#/$defs/day" },
          tuesday: { $ref: "#/$defs/day" },
          wednesday: { $ref: "#/$defs/day" },
          thursday: { $ref: "#/$defs/day" },
          friday: { $ref: "#/$defs/day" },
          saturday: { $ref: "#/$defs/day" },
          sunday: { $ref: "#/$defs/day" }
        }
      },
      week_summary: {
        type: "object",
        additionalProperties: false,
        properties: {
          twm: { type: ["string", "null"] },
          notes: { type: ["string", "null"] }
        }
      }
    },
    $defs: {
      day: {
        type: "object",
        additionalProperties: false,
        required: ["activities"],
        properties: {
          activities: {
            type: "array",
            items: { $ref: "#/$defs/activity" }
          }
        }
      },
      activity: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "raw_text", "instruction_text"],
        properties: {
          type: {
            type: "string",
            enum: [
              "run",
              "strength",
              "cross_train",
              "rest",
              "mobility",
              "yoga",
              "hike",
              "other"
            ]
          },
          subtype: { type: ["string", "null"] },
          session_type: {
            type: ["string", "null"],
            enum: [
              "easy",
              "long_run",
              "interval",
              "tempo",
              "hill",
              "recovery",
              "rest",
              "cross_train",
              "strength",
              "race",
              "time_trial",
              null
            ]
          },
          primary_sport: {
            type: ["string", "null"],
            enum: ["run", "bike", "swim", "strength", "mobility", "other", null]
          },
          title: { type: "string" },
          raw_text: { type: "string" },
          instruction_text: { type: ["string", "null"] },
          metrics: {
            type: "object",
            additionalProperties: false,
            properties: {
              distance: {
                type: "object",
                additionalProperties: false,
                properties: {
                  value: { type: "number" },
                  unit: { type: "string", enum: ["miles", "km"] }
                }
              },
              duration_min: { type: ["number", "null"] },
              pace_target: { type: ["string", "null"] },
              effort_target: { type: ["string", "null"] }
            }
          },
          target_intensity: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["pace", "hr", "rpe"] },
              value: { type: "string" }
            }
          },
          structure: { type: ["object", "null"] },
          tags: { type: ["array", "null"], items: { type: "string" } },
          priority: { type: ["string", "null"], enum: ["key", "medium", "optional", null] },
          is_key_session: { type: ["boolean", "null"] },
          warmup_cooldown_included: { type: ["boolean", "null"] },
          constraints: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              bail_allowed: { type: ["boolean", "null"] },
              must_do: { type: ["boolean", "null"] }
            }
          }
        }
      }
    }
  }
};

export type ParsedWeek = {
  week_number: number;
  days: Record<string, { activities: Array<any> }>;
  week_summary?: { twm?: string | null; notes?: string | null };
};

export async function parseWeekWithAI(args: {
  planName: string;
  weekNumber: number;
  days: Record<string, string>;
  legend?: string;
  planGuide?: string;
  programProfile?: ProgramDocumentProfile;
  model?: string;
}) {
  const model = args.model || getDefaultAiModel();

  const input = [
    "You are a training-plan parser.",
    "Return JSON that matches the provided schema exactly.",
    "Split multi-activity cells into multiple activities.",
    "Input cells may be in English, German, or French.",
    "Map common localized terms to the schema types (e.g., rest/repose/Ruhetag, strength/musculation/Kraft, cross training/entrainement croise/Alternativtraining).",
    "Detect distance units precisely from text:",
    "- Use 'miles' for mile/mi notation.",
    "- Treat meilen/milles as miles.",
    "- Use 'km' for kilometer/kilometre/km notation.",
    "- Treat kilometre/kilometer variants in German/French as km.",
    "- If distance is written in meters (m/meter/metre), convert to km (e.g. 400m => 0.4 km).",
    "- Treat minute/minuten and heure/stunde as duration units when present.",
    "Decode abbreviations (WU, CD, T, I, LR, LRL, E, XT, STR, RST, MOB, YOG, HIK, RP, MP, NS).",
    "Interpret ★ as must_do and ♥ as bail_allowed.",
    "Preserve raw_text exactly as written in each cell when possible.",
    "Also provide instruction_text as plain, readable coaching text with abbreviations expanded. Use the plan context guide to resolve abbreviations in raw cells and write detailed instruction_text.",
    "Infer session_type and primary_sport when possible (leave null when uncertain).",
    "Use target_intensity.type/value for explicit pace/heart-rate/RPE targets when present.",
    "For days where the raw cell is empty, return zero activities.",
    "WARMUP/COOLDOWN RULE: When a cell describes a structured workout with a Warmup + quality effort + Cooldown (e.g. '1mi WU, 4mi Tempo, 1mi CD'), create ONE activity. Classify it by the quality effort (e.g. session_type='tempo'). Set metrics.distance and target_intensity to the quality segment only — NOT the total session distance. Put the full session structure in instruction_text.",
    "RANGE RULE: When distance or duration is given as a range (e.g. '4-5 miles', '8-10 km', '40-50 min'), always use the UPPER bound as the numeric value (5 miles, 10 km, 50 min).",
    `Plan name: ${args.planName}`,
    args.programProfile
      ? `Program context (hints only; raw cells win if they conflict):\n${JSON.stringify(args.programProfile, null, 2)}`
      : "",
    args.legend ? `Legend:\n${args.legend}` : "",
    args.planGuide ? `Plan context guide (use to resolve abbreviations and expand instructions):\n${args.planGuide}` : "",
    `Week ${args.weekNumber} raw cells:`,
    JSON.stringify(args.days, null, 2)
  ]
    .filter(Boolean)
    .join("\n");

  return openaiJsonSchema<ParsedWeek>({
    input,
    schema: WEEK_SCHEMA,
    model
  });
}

/**
 * Bridge: run Parser V4 on the PDF buffer.
 * Always resolves — never throws.
 * Returns the validated ProgramJsonV1 data if parsing succeeded, or null.
 *
 * @param pdfBuffer  Raw PDF bytes from the upload
 * @param planId     Optional plan ID for linking the ParseJob record
 */
export async function maybeRunParserV4(
  pdfBuffer: Buffer,
  planId?: string,
  planGuide?: string
): Promise<{ data: import('./schemas/program-json-v1').ProgramJsonV1 | null; promptName: string | null; parseWarning: string | null }> {
  if (!FLAGS.PARSER_V4) return { data: null, promptName: null, parseWarning: null };
  let jobId: string | null = null;

  const fail = async (err: unknown, phase: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ParserV4] ${phase} failed (non-fatal)`, { planId, error: msg });
    if (FLAGS.PARSE_DUAL_WRITE && jobId) {
      try {
        await updateParseJobStatus(jobId, 'FAILED', `[${phase}] ${msg}`);
      } catch (dbErr) {
        console.error('[ParserV4] Could not update job status to FAILED', {
          jobId,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr)
        });
      }
    }
  };

  // 1. Extract text
  let fullText: string;
  try {
    ({ fullText } = await extractPdfText(pdfBuffer));
    console.info('[ParserV4] Text extracted', { planId, chars: fullText.length });
  } catch (err) {
    await fail(err, 'extractPdfText');
    return { data: null, promptName: null, parseWarning: null };
  }

  // 2. Create ParseJob
  if (FLAGS.PARSE_DUAL_WRITE) {
    try {
      const job = await createParseJob({ planId, parserVersion: 'v4' });
      jobId = job.id;
      console.info('[ParserV4] ParseJob created', { jobId, planId });
    } catch (err) {
      console.error('[ParserV4] createParseJob failed (non-fatal)', {
        planId,
        error: err instanceof Error ? err.message : String(err)
      });
      return { data: null, promptName: null, parseWarning: null };
    }
  }

  // 3. Fetch active parser prompt from DB (fall back to hardcoded constant on error)
  let activePromptText: string | undefined;
  let activePromptName: string | null = null;
  try {
    const active = await prisma.parserPrompt.findFirst({
      where: { isActive: true },
      select: { text: true, name: true }
    });
    if (active) {
      activePromptText = active.text;
      activePromptName = active.name;
    }
  } catch { /* silently use hardcoded fallback */ }

  // 4. Run V4 AI parsing
  let result: Awaited<ReturnType<typeof runParserV4>> | null = null;
  let rawParseError: string | null = null;
  try {
    const planLengthWeeks = planGuide ? parsePlanLengthFromGuide(planGuide) ?? undefined : undefined;
    result = await runParserV4(fullText, activePromptText, planLengthWeeks, planGuide);
    console.info('[ParserV4] AI parse complete', {
      planId,
      jobId,
      validated: result.validated,
      weeks: (result.rawJson as { weeks?: unknown[] })?.weeks?.length ?? 0
    });
  } catch (err) {
    rawParseError = err instanceof Error ? err.message : String(err);
    console.error('[ParserV4] runParserV4 failed (non-fatal)', { planId, error: rawParseError });
  }

  // 5. Save artifact + update status
  // Always save something — even on parse failure — so the truncated/raw
  // response is visible in /admin/parse-debug.
  if (FLAGS.PARSE_DUAL_WRITE && jobId) {
    try {
      const artifactJson = result?.rawJson ?? { error: rawParseError };
      await saveParseArtifact({
        parseJobId: jobId,
        artifactType: 'program_json',
        schemaVersion: 'v1',
        json: artifactJson,
        validationOk: result?.validated ?? false
      });
      await updateParseJobStatus(
        jobId,
        result?.validated ? 'SUCCESS' : 'FAILED',
        result?.validated ? undefined : (result?.validationError ?? rawParseError ?? undefined)
      );
      console.info('[ParserV4] Artifact saved', { jobId, validationOk: result?.validated ?? false });
    } catch (err) {
      await fail(err, 'saveArtifact');
    }
  }

  return {
    data: result?.validated && result.data ? result.data : null,
    promptName: activePromptName,
    parseWarning: result?.validationError ?? null
  };
}

/**
 * Bridge: run Parser V5 on the PDF buffer.
 * Always resolves — never throws.
 * Returns the validated ProgramJsonV1 data if parsing succeeded, or null.
 *
 * @param pdfBuffer  Raw PDF bytes from the upload
 * @param planId     Optional plan ID for linking the ParseJob record
 */
export async function maybeRunParserV5(
  pdfBuffer: Buffer,
  planId?: string
): Promise<{ data: import('./schemas/program-json-v1').ProgramJsonV1 | null; parseWarning: string | null; survey: import('./parsing/v5-survey-schema').SurveyJsonV1 | null }> {
  if (!FLAGS.PARSER_V5) return { data: null, parseWarning: null, survey: null };
  let jobId: string | null = null;

  const fail = async (err: unknown, phase: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ParserV5] ${phase} failed (non-fatal)`, { planId, error: msg });
    if (FLAGS.PARSE_DUAL_WRITE && jobId) {
      try {
        await updateParseJobStatus(jobId, 'FAILED', `[${phase}] ${msg}`);
      } catch (dbErr) {
        console.error('[ParserV5] Could not update job status to FAILED', {
          jobId,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr)
        });
      }
    }
  };

  // 1. Extract text
  let fullText: string;
  try {
    ({ fullText } = await extractPdfText(pdfBuffer));
    console.info('[ParserV5] Text extracted', { planId, chars: fullText.length });
  } catch (err) {
    await fail(err, 'extractPdfText');
    return { data: null, parseWarning: null, survey: null };
  }

  // 2. Create ParseJob
  if (FLAGS.PARSE_DUAL_WRITE) {
    try {
      const job = await createParseJob({ planId, parserVersion: 'v5' });
      jobId = job.id;
      console.info('[ParserV5] ParseJob created', { jobId, planId });
    } catch (err) {
      console.error('[ParserV5] createParseJob failed (non-fatal)', {
        planId,
        error: err instanceof Error ? err.message : String(err)
      });
      return { data: null, parseWarning: null, survey: null };
    }
  }

  // 3. Fetch active parser prompt from DB (fall back to hardcoded constant on error)
  let activePromptText: string | undefined;
  try {
    const active = await prisma.parserPrompt.findFirst({
      where: { isActive: true },
      select: { text: true, name: true }
    });
    if (active) {
      activePromptText = active.text;
    }
  } catch { /* silently use hardcoded fallback */ }

  // 4. Run V5 AI parsing (survey → V4 extraction with survey context)
  let result: Awaited<ReturnType<typeof runParserV5>> | null = null;
  let rawParseError: string | null = null;
  try {
    result = await runParserV5(fullText, activePromptText);
    console.info('[ParserV5] AI parse complete', {
      planId,
      jobId,
      validated: result.validated,
      weeks: result.data?.weeks.length ?? 0,
      truncated: result.truncated,
      threePass: result.threePass
    });
  } catch (err) {
    rawParseError = err instanceof Error ? err.message : String(err);
    console.error('[ParserV5] runParserV5 failed (non-fatal)', { planId, error: rawParseError });
  }

  // 5. Save survey artifact
  if (FLAGS.PARSE_DUAL_WRITE && jobId && result?.survey) {
    try {
      await saveParseArtifact({
        parseJobId: jobId,
        artifactType: 'survey_json',
        schemaVersion: 'v1',
        json: result.survey,
        validationOk: true
      });
    } catch (err) {
      await fail(err, 'saveSurveyArtifact');
    }
  }

  // 6. Save program artifact + update status
  if (FLAGS.PARSE_DUAL_WRITE && jobId) {
    try {
      const artifactJson = result?.rawJson ?? { error: rawParseError };
      await saveParseArtifact({
        parseJobId: jobId,
        artifactType: 'program_json',
        schemaVersion: 'v1',
        json: artifactJson,
        validationOk: result?.validated ?? false
      });
      await updateParseJobStatus(
        jobId,
        result?.validated ? 'SUCCESS' : 'FAILED',
        result?.validated ? undefined : (result?.validationError ?? rawParseError ?? undefined)
      );
      console.info('[ParserV5] Artifact saved', { jobId, validationOk: result?.validated ?? false });
    } catch (err) {
      await fail(err, 'saveArtifact');
    }
  }

  return {
    data: result?.validated && result.data ? result.data : null,
    parseWarning: result?.validationError ?? null,
    survey: result?.survey ?? null
  };
}

/**
 * Vision extraction pipeline: PDF → enriched MD → simplified V4 parser.
 * Always resolves — never throws.
 * Only runs when FLAGS.PARSER_VISION_EXTRACT is true.
 *
 * Flow:
 *   1. extractPlanMd() — Claude vision call, returns enriched plan.md
 *   2. Store plan.md as ParseArtifact type "EXTRACTED_MD"
 *   3. chunkMd() — split at ## Week N headers (5-week chunks)
 *   4. runParserV4() per chunk with MD_PARSER_PROMPT
 *   5. Merge results, return ProgramJsonV1
 */
export async function maybeRunVisionExtract(
  pdfBuffer: Buffer,
  planId?: string
): Promise<{ data: ProgramJsonV1 | null; parseWarning: string | null; extractedMd: string | null }> {
  if (!FLAGS.PARSER_VISION_EXTRACT) {
    return { data: null, parseWarning: null, extractedMd: null };
  }

  // ── Step 1: PDF → enriched MD ──────────────────────────────────────────────
  let planMd: string;
  try {
    planMd = await extractPlanMd(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[VisionExtract] extractPlanMd failed', { error: msg });
    return { data: null, parseWarning: `Vision extraction failed: ${msg}`, extractedMd: null };
  }

  // ── Step 2: Store plan.md as artifact ─────────────────────────────────────
  let parseJobId: string | undefined;
  if (FLAGS.PARSE_DUAL_WRITE) {
    try {
      const job = await createParseJob({ planId, parserVersion: 'vision-v1' });
      parseJobId = job.id;
      await saveParseArtifact({
        parseJobId: job.id,
        artifactType: 'EXTRACTED_MD',
        schemaVersion: 'v1',
        json: { md: planMd },
        validationOk: true
      });
    } catch (err) {
      console.error('[VisionExtract] Failed to create ParseJob / save EXTRACTED_MD artifact', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // ── Step 3: Chunk MD at ## Week N headers ──────────────────────────────────
  const chunks = chunkMd(planMd, 5);
  console.info('[VisionExtract] MD chunked', { chunks: chunks.length });

  // ── Step 4: Run V4 parser on each chunk with simplified prompt ─────────────
  const passResults = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return {
          data: await runVisionMdChunkWithRetries(
            chunk,
            async (retryChunk) => {
              const result = await runParserV4(
                retryChunk.text,
                MD_PARSER_PROMPT,
                undefined,
                undefined,
                { expectedWeekNumbers: retryChunk.weekNumbers }
              );
              return result.data
                ? alignProgramWeeksToExpectedChunk(result.data, retryChunk.weekNumbers)
                : null;
            },
            [3, 2, 1],
          )
        };
      } catch (err) {
        console.error('[VisionExtract] runParserV4 chunk failed', {
          weeks: chunk.weekNumbers,
          error: err instanceof Error ? err.message : String(err)
        });
        return { data: null };
      }
    })
  );

  const successfulPasses = passResults.filter(
    (p): p is { data: ProgramJsonV1 } => p.data !== null
  );

  if (successfulPasses.length === 0) {
    const warning = 'Vision pipeline: all V4 chunk passes failed';
    if (parseJobId) {
      try {
        await updateParseJobStatus(parseJobId, 'FAILED', warning);
      } catch { /* non-fatal */ }
    }
    return { data: null, parseWarning: warning, extractedMd: planMd };
  }

  // ── Step 5: Merge results ──────────────────────────────────────────────────
  const mergedWeeks = mergeWeeksFromPasses(successfulPasses);
  const inferredPlanLengthWeeks = mergedWeeks.reduce((max, week) => {
    return week.week_number > max ? week.week_number : max;
  }, 0);
  const merged: ProgramJsonV1 = {
    program: {
      ...successfulPasses[0].data.program,
      plan_length_weeks: Math.max(
        successfulPasses[0].data.program.plan_length_weeks ?? 0,
        inferredPlanLengthWeeks,
      ),
    },
    weeks: mergedWeeks,
    quality_checks: { weeks_detected: mergedWeeks.length, missing_days: [], anomalies: [] }
  };

  const validation = ProgramJsonV1Schema.safeParse(merged);
  const data = validation.success ? validation.data : null;
  const parseWarning = !validation.success
    ? `Vision pipeline validation failed: ${validation.error.message}`
    : null;

  if (parseJobId) {
    try {
      await saveParseArtifact({
        parseJobId,
        artifactType: 'V4_OUTPUT',
        schemaVersion: 'v1',
        json: merged,
        validationOk: validation.success
      });
      await updateParseJobStatus(parseJobId, validation.success ? 'SUCCESS' : 'FAILED', parseWarning ?? undefined);
    } catch { /* non-fatal */ }
  }

  console.info('[VisionExtract] Complete', { weeks: mergedWeeks.length, validated: validation.success });
  return { data, parseWarning, extractedMd: planMd };
}
