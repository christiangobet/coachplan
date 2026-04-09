import { getDefaultAiModel, openaiJsonSchema } from "../openai.ts";
import type { SessionV1 } from "../schemas/program-json-v1.ts";

export type MarkdownSessionEnrichmentContext = {
  planName?: string | null;
  weekNumber: number;
  dayLabel: string;
  weekSummary?: string | null;
  glossary?: string | null;
  trainerNotes?: string | null;
};

export type MarkdownSessionEnrichmentArgs = {
  session: SessionV1;
  context: MarkdownSessionEnrichmentContext;
  model?: string;
  signal?: AbortSignal;
};

export type MarkdownSessionEnrichmentResult = {
  session: SessionV1;
  prompt: string;
};

const SESSION_ENRICHMENT_SCHEMA = {
  name: "markdown_session_enrichment",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["session_role", "session_focus", "intensity", "notes", "coaching_note"],
    properties: {
      session_role: { type: ["string", "null"] },
      session_focus: {
        type: ["string", "null"],
        enum: ["tempo", "threshold", "recovery", "long_run", "race_sim", "strength", "other", null],
      },
      intensity: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      coaching_note: { type: ["string", "null"] },
    },
  },
} as const;

export function buildMarkdownSessionEnrichmentPrompt(args: MarkdownSessionEnrichmentArgs): string {
  const sessionJson = JSON.stringify(args.session, null, 2);
  const contextLines = [
    `Plan: ${args.context.planName ?? "Unknown plan"}`,
    `Week: ${args.context.weekNumber}`,
    `Day: ${args.context.dayLabel}`,
    args.context.weekSummary ? `Week summary: ${args.context.weekSummary}` : null,
    args.context.glossary ? `Glossary: ${args.context.glossary}` : null,
    args.context.trainerNotes ? `Trainer notes: ${args.context.trainerNotes}` : null,
  ].filter(Boolean);

  return [
    "You are enriching a single session from a training plan.",
    "Work on one session only.",
    "Do not parse or rewrite the rest of the program.",
    "Do not reinterpret week boundaries, day boundaries, or table structure.",
    "Only refine these fields when they are already supported by the session text:",
    "- session_role",
    "- coaching_note",
    "- session_focus",
    "- intensity",
    "- notes",
    "Keep any existing structural fields unless the session clearly supports a narrow refinement.",
    "Return only the enriched single session object.",
    "",
    ...contextLines,
    "",
    "Session JSON:",
    sessionJson,
  ].join("\n");
}

export async function enrichMarkdownSession(
  args: MarkdownSessionEnrichmentArgs,
): Promise<MarkdownSessionEnrichmentResult> {
  const prompt = buildMarkdownSessionEnrichmentPrompt(args);
  const model = args.model || getDefaultAiModel();

  try {
    const result = await openaiJsonSchema<{
      session_role: SessionV1["session_role"];
      session_focus: SessionV1["session_focus"];
      intensity: SessionV1["intensity"];
      notes: SessionV1["notes"];
      coaching_note: SessionV1["coaching_note"];
    }>({
      input: prompt,
      schema: SESSION_ENRICHMENT_SCHEMA,
      model,
      signal: args.signal,
    });

    return {
      prompt,
      session: {
        ...args.session,
        session_role: result.session_role ?? args.session.session_role ?? null,
        session_focus: result.session_focus ?? args.session.session_focus ?? null,
        intensity: result.intensity ?? args.session.intensity ?? null,
        notes: result.notes ?? args.session.notes ?? null,
        coaching_note: result.coaching_note ?? args.session.coaching_note ?? null,
      },
    };
  } catch (error) {
    console.warn("[MarkdownSessionEnricher] enrichment failed; using deterministic session", {
      weekNumber: args.context.weekNumber,
      dayLabel: args.context.dayLabel,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      prompt,
      session: args.session,
    };
  }
}

export default {
  buildMarkdownSessionEnrichmentPrompt,
  enrichMarkdownSession,
};
