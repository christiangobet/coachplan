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

// OpenAI structured output requires ALL properties in `required`.
// Optional numeric/string fields use nullable types so the model can return null when absent.

// Child step schema (no further nesting — avoids infinite recursion in JSON Schema)
const CHILD_STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "distance_miles", "distance_km", "duration_minutes", "pace_target", "effort", "description"],
  properties: {
    type: { type: "string", enum: ["warmup", "cooldown", "tempo", "interval", "recovery", "easy", "distance", "note"] },
    distance_miles: { type: ["number", "null"] },
    distance_km: { type: ["number", "null"] },
    duration_minutes: { type: ["number", "null"] },
    pace_target: { type: ["string", "null"] },
    effort: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
  },
} as const;

// Top-level step schema (allows one level of repeat nesting)
const STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "repetitions", "steps", "distance_miles", "distance_km", "duration_minutes", "pace_target", "effort", "description"],
  properties: {
    type: { type: "string", enum: ["warmup", "cooldown", "tempo", "interval", "recovery", "easy", "distance", "note", "repeat"] },
    repetitions: { type: ["number", "null"] },
    steps: { type: "array", items: CHILD_STEP_SCHEMA },
    distance_miles: { type: ["number", "null"] },
    distance_km: { type: ["number", "null"] },
    duration_minutes: { type: ["number", "null"] },
    pace_target: { type: ["string", "null"] },
    effort: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
  },
} as const;

const SESSION_ENRICHMENT_SCHEMA = {
  name: "markdown_session_enrichment",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["session_role", "session_focus", "intensity", "notes", "coaching_note", "steps"],
    properties: {
      session_role: { type: ["string", "null"] },
      session_focus: {
        type: ["string", "null"],
        enum: ["tempo", "threshold", "recovery", "long_run", "race_sim", "strength", "other", null],
      },
      intensity: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      coaching_note: { type: ["string", "null"] },
      steps: { type: "array", items: STEP_SCHEMA },
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
    "Work on one session only. Do not parse or rewrite the rest of the program.",
    "Do not reinterpret week boundaries, day boundaries, or table structure.",
    "",
    "Extract the following from the session's raw_text:",
    "1. session_role — short name/label for the session (e.g. 'Tempo Run', 'Hill Repeats', 'Incline Treadmill')",
    "2. session_focus — one of: tempo, threshold, recovery, long_run, race_sim, strength, other, null",
    "3. intensity — effort description (e.g. '7/10 effort', 'comfortably hard')",
    "4. notes — any context or instructions not captured elsewhere",
    "5. coaching_note — motivational or tactical guidance for the athlete",
    "6. steps — structured breakdown of the session flow:",
    "   - Use 'warmup' for WU / warm-up phases",
    "   - Use 'cooldown' for CD / cool-down phases",
    "   - Use 'interval' for hard efforts within repeats",
    "   - Use 'recovery' for rest / jog-back / easy recovery between efforts",
    "   - Use 'repeat' (with repetitions + nested steps) for N-times blocks like '4 x 90 sec uphill'",
    "   - Use 'tempo' for sustained moderate-to-hard efforts",
    "   - Use 'distance' for structured progression phases (e.g. increase incline 1% every 3 min)",
    "   - Use 'note' for instructions that don't fit other types",
    "   - Extract distance_miles, distance_km, duration_minutes, pace_target, effort where present",
    "   - Return [] if the session has no clear internal structure (e.g. simple 'Easy run')",
    "",
    "Only refine session_role/session_focus/intensity/notes/coaching_note when clearly supported by the text.",
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
      steps: SessionV1["steps"];
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
        // Only use extracted steps if the session doesn't already have them
        steps: (args.session.steps?.length ? args.session.steps : null) ?? result.steps ?? [],
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
