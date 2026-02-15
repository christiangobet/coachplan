import { getDefaultAiModel, openaiJsonSchema } from "./openai";

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
        required: ["type", "title", "raw_text"],
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
          title: { type: "string" },
          raw_text: { type: "string" },
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
          structure: { type: ["object", "null"] },
          tags: { type: ["array", "null"], items: { type: "string" } },
          priority: { type: ["string", "null"], enum: ["key", "medium", "optional", null] },
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
    `Plan name: ${args.planName}`,
    args.legend ? `Legend:\n${args.legend}` : "",
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
