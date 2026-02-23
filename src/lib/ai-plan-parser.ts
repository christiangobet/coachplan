import { getDefaultAiModel, openaiJsonSchema } from "./openai";
import type { ProgramDocumentProfile } from "./plan-document-profile";
import { FLAGS } from "./feature-flags";
import { extractPdfText } from "./pdf/extract-text";
import { runParserV4 } from "./parsing/plan-parser-v4";
import {
  createParseJob,
  updateParseJobStatus,
  saveParseArtifact
} from "./parsing/parse-artifacts";

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
  planId?: string
): Promise<import('./schemas/program-json-v1').ProgramJsonV1 | null> {
  if (!FLAGS.PARSER_V4) return null;
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
    return null;
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
      return null;
    }
  }

  // 3. Run V4 AI parsing
  let result: Awaited<ReturnType<typeof runParserV4>> | null = null;
  let rawParseError: string | null = null;
  try {
    result = await runParserV4(fullText);
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

  // 4. Save artifact + update status
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

  return result?.validated && result.data ? result.data : null;
}
