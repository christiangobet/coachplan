import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { ProgramJsonV1 } from "../src/lib/schemas/program-json-v1.ts";

const moduleHref = new URL("../src/lib/parsing/upload-orchestrator.ts", import.meta.url).href;

function buildProgram(overrides: Partial<ProgramJsonV1> = {}): ProgramJsonV1 {
  return {
    program: {
      title: "Sample Plan",
      distance_target: "HALF",
      plan_length_weeks: 1,
      layout_type: "calendar_grid",
      source_units: "miles",
      intensity_rules: {},
      training_rules: {},
      phase_rules: [],
      progression: {},
      symbol_dictionary: {},
      glossary: {},
      assumptions: [],
      program_notes: [],
    },
    weeks: [
      {
        week_number: 1,
        sessions: [
          {
            day_of_week: "Sat",
            activity_type: "Run",
            raw_text: "8 mi LR",
            session_role: "Long Run",
            priority: false,
            optional: false,
            notes: null,
            intensity: null,
            steps: [],
            optional_alternatives: [],
          },
        ],
      },
    ],
    quality_checks: {
      weeks_detected: 1,
      missing_days: [],
      anomalies: [],
    },
    ...overrides,
  };
}

test("upload route is wired through the parser orchestrator entrypoint", async () => {
  const routeSource = await readFile(
    new URL("../src/app/api/plans/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /orchestrateUploadParsing/);
});

test("chooseBaseParser prefers the legacy structural parser for dense table documents", async () => {
  const { chooseBaseParser } = await import(moduleHref);

  const base = chooseBaseParser({
    weekMarkers: 18,
    glossaryDensity: 0.01,
    tableDensity: 0.82,
    ocrNoiseDensity: 0.01,
    lineBreakDensity: 0.28,
    symbolicDensity: 0.02,
    multilingualHints: false,
  }, ["vision", "v4", "v5", "legacy"]);

  assert.equal(base, "legacy");
});

test("chooseBaseParser prefers vision for noisy OCR-like documents", async () => {
  const { chooseBaseParser } = await import(moduleHref);

  const base = chooseBaseParser({
    weekMarkers: 4,
    glossaryDensity: 0.0,
    tableDensity: 0.08,
    ocrNoiseDensity: 0.29,
    lineBreakDensity: 0.04,
    symbolicDensity: 0.0,
    multilingualHints: true,
  }, ["vision", "v4", "v5", "legacy"]);

  assert.equal(base, "vision");
});

test("mergeProgramOwnership preserves the base skeleton and only enriches owned fields", async () => {
  const { mergeProgramsWithOwnership } = await import(moduleHref);

  const base = buildProgram();
  const enrichment = buildProgram({
    weeks: [
      {
        week_number: 9,
        sessions: [
          {
            day_of_week: "Tue",
            activity_type: "Run",
            raw_text: "8 mi LR",
            session_role: "Long Run",
            priority: false,
            optional: false,
            notes: "Keep the final 2 miles controlled.",
            coaching_note: "Stay relaxed on hills.",
            session_focus: "long_run",
            intensity: "Easy pace",
            steps: [
              { type: "warmup", duration_minutes: 10, description: "Settle in" },
              { type: "distance", distance_miles: 8, description: "Long run" },
            ],
            optional_alternatives: [],
          },
        ],
      },
    ],
  });

  const merged = mergeProgramsWithOwnership(base, [
    { parser: "vision", data: enrichment, quality: { score: 91 } },
  ]);

  assert.equal(merged.weeks[0]?.week_number, 1);
  assert.equal(merged.weeks[0]?.sessions[0]?.day_of_week, "Sat");
  assert.equal(merged.weeks[0]?.sessions[0]?.notes, "Keep the final 2 miles controlled.");
  assert.equal(merged.weeks[0]?.sessions[0]?.coaching_note, "Stay relaxed on hills.");
  assert.equal(merged.weeks[0]?.sessions[0]?.intensity, "Easy pace");
  assert.equal(merged.weeks[0]?.sessions[0]?.steps.length, 2);
});

test("orchestrateUploadParsing falls back when the selected base parser is not viable", async () => {
  const { orchestrateUploadParsing } = await import(moduleHref);

  const result = await orchestrateUploadParsing({
    signals: {
      weekMarkers: 3,
      glossaryDensity: 0,
      tableDensity: 0.12,
      ocrNoiseDensity: 0.19,
      lineBreakDensity: 0.05,
      symbolicDensity: 0.01,
      multilingualHints: false,
    },
    budgetMs: 180_000,
    candidates: ["vision", "legacy"],
    runCandidate: async (parser: "vision" | "legacy") => {
      if (parser === "vision") {
        return {
          parser,
          kind: "program",
          viable: false,
          quality: { score: 24 },
          data: null,
          warning: "vision failed validation",
        };
      }

      return {
        parser,
        kind: "legacy",
        viable: true,
        quality: { score: 63 },
        data: { weeks: [] },
        warning: null,
      };
    },
  });

  assert.equal(result.selectedBaseParser, "vision");
  assert.equal(result.finalParser, "legacy");
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.candidateRuns.map((run: { parser: string }) => run.parser), ["vision", "legacy"]);
});

test("orchestrateUploadParsing promotes a viable program parser over a legacy base result", async () => {
  const { orchestrateUploadParsing } = await import(moduleHref);

  const result = await orchestrateUploadParsing({
    signals: {
      weekMarkers: 18,
      glossaryDensity: 0.01,
      tableDensity: 0.82,
      ocrNoiseDensity: 0.01,
      lineBreakDensity: 0.28,
      symbolicDensity: 0.02,
      multilingualHints: false,
    },
    budgetMs: 180_000,
    candidates: ["vision", "legacy"],
    runCandidate: async (parser: "vision" | "legacy") => {
      if (parser === "legacy") {
        return {
          parser,
          kind: "legacy",
          viable: true,
          quality: { score: 78, weekCount: 17, dayCoverage: 1 },
          data: { weeks: [] },
          warning: null,
        };
      }

      return {
        parser,
        kind: "program",
        viable: true,
        quality: { score: 74, weekCount: 17, dayCoverage: 1, notesCoverage: 0.92, structureCoverage: 0.4, sessionCount: 119 },
        data: buildProgram({
          program: {
            ...buildProgram().program,
            plan_length_weeks: 17,
          },
          weeks: Array.from({ length: 17 }, (_, index) => ({
            week_number: index + 1,
            sessions: [
              {
                day_of_week: "Mon",
                activity_type: "Run",
                raw_text: `Week ${index + 1} easy run`,
                session_role: "Easy Run",
                priority: false,
                optional: false,
                notes: "Parsed from extracted markdown",
                coaching_note: null,
                intensity: "Easy",
                steps: [],
                optional_alternatives: [],
              },
            ],
          })),
          quality_checks: {
            weeks_detected: 17,
            missing_days: [],
            anomalies: [],
          },
        }),
        warning: null,
      };
    },
  });

  assert.equal(result.selectedBaseParser, "legacy");
  assert.equal(result.finalParser, "vision");
  assert.equal(result.resultKind, "program");
  assert.equal(result.usedFallback, false);
  assert.equal(result.program?.weeks.length, 17);
  assert.deepEqual(result.candidateRuns.map((run: { parser: string }) => run.parser), ["legacy", "vision"]);
});

test("orchestrateUploadParsing can promote a seeded vision result over a legacy base without rerunning vision", async () => {
  const { orchestrateUploadParsing } = await import(moduleHref);

  let visionCalls = 0;

  const result = await orchestrateUploadParsing({
    signals: {
      weekMarkers: 18,
      glossaryDensity: 0.01,
      tableDensity: 0.82,
      ocrNoiseDensity: 0.01,
      lineBreakDensity: 0.28,
      symbolicDensity: 0.02,
      multilingualHints: false,
    },
    budgetMs: 10_000,
    enrichBudgetFloorMs: 45_000,
    candidates: ["vision", "legacy"],
    seedRuns: [
      {
        parser: "vision",
        kind: "program",
        viable: true,
        quality: { score: 71, weekCount: 17, dayCoverage: 1, notesCoverage: 0.9, structureCoverage: 0.4, sessionCount: 102 },
        data: buildProgram({
          program: {
            ...buildProgram().program,
            plan_length_weeks: 17,
          },
          weeks: Array.from({ length: 17 }, (_, index) => ({
            week_number: index + 1,
            sessions: [
              {
                day_of_week: "Mon",
                activity_type: "Run",
                raw_text: `Week ${index + 1} seeded markdown run`,
                session_role: "Easy Run",
                priority: false,
                optional: false,
                notes: "Seeded from extracted markdown",
                coaching_note: null,
                intensity: "Easy",
                steps: [],
                optional_alternatives: [],
              },
            ],
          })),
          quality_checks: {
            weeks_detected: 17,
            missing_days: [],
            anomalies: [],
          },
        }),
        warning: null,
      },
    ],
    runCandidate: async (parser: "vision" | "legacy") => {
      if (parser === "vision") {
        visionCalls += 1;
        return {
          parser,
          kind: "program",
          viable: false,
          quality: { score: 0 },
          data: null,
          warning: "vision should not rerun",
        };
      }

      return {
        parser,
        kind: "legacy",
        viable: true,
        quality: { score: 78, weekCount: 17, dayCoverage: 1 },
        data: { weeks: [] },
        warning: null,
      };
    },
  });

  assert.equal(result.selectedBaseParser, "legacy");
  assert.equal(result.finalParser, "vision");
  assert.equal(result.resultKind, "program");
  assert.equal(result.program?.weeks.length, 17);
  assert.equal(visionCalls, 0);
  assert.deepEqual(result.candidateRuns.map((run: { parser: string }) => run.parser), ["vision", "legacy"]);
});
