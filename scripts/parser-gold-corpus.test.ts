import test from "node:test";
import assert from "node:assert/strict";

import type { ProgramJsonV1 } from "../src/lib/schemas/program-json-v1.ts";

const moduleHref = new URL("../src/lib/parsing/gold-corpus.ts", import.meta.url).href;

function buildProgram(overrides: Partial<ProgramJsonV1> = {}): ProgramJsonV1 {
  return {
    program: {
      title: "Corpus Plan",
      distance_target: "10K",
      plan_length_weeks: 1,
      layout_type: "calendar_grid",
      source_units: "km",
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
        week_brief: "Build endurance carefully.",
        sessions: [
          {
            day_of_week: "Tue",
            activity_type: "Run",
            raw_text: "6 km easy",
            session_role: "Easy Run",
            priority: false,
            optional: false,
            notes: "Stay conversational.",
            intensity: "Easy pace",
            steps: [],
            optional_alternatives: [],
          },
          {
            day_of_week: "Sat",
            activity_type: "Run",
            raw_text: "10 km long",
            session_role: "Long Run",
            priority: false,
            optional: false,
            notes: null,
            intensity: null,
            steps: [{ type: "distance", distance_km: 10, description: "Long run" }],
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

test("scoreProgramAgainstGold rewards exact matches across canonical plan tables and guide", async () => {
  const { scoreProgramAgainstGold } = await import(moduleHref);

  const expected = {
    id: "exact-match",
    layoutFamily: "calendar_grid",
    guide: "PLAN OVERVIEW\n- 1 week\n\nGLOSSARY & ABBREVIATIONS\n- LR = Long Run",
    program: buildProgram(),
  };

  const score = scoreProgramAgainstGold(expected, {
    guide: expected.guide,
    program: expected.program,
    latencyMs: 12_300,
    estimatedCostUsd: 0.18,
  });

  assert.equal(score.overall, 1);
  assert.equal(score.breakdown.weekDetection, 1);
  assert.equal(score.breakdown.dayAssignment, 1);
  assert.equal(score.breakdown.activityTyping, 1);
  assert.equal(score.breakdown.rawTextPreservation, 1);
  assert.equal(score.breakdown.notesCoverage, 1);
  assert.equal(score.breakdown.structureCoverage, 1);
  assert.equal(score.breakdown.guideCompleteness, 1);
  assert.equal(score.breakdown.nullHandling, 1);
});

test("scoreProgramAgainstGold penalizes invented content and missing structure", async () => {
  const { scoreProgramAgainstGold } = await import(moduleHref);

  const expected = {
    id: "mismatch",
    layoutFamily: "calendar_grid",
    guide: "PLAN OVERVIEW\n- 1 week",
    program: buildProgram(),
  };

  const actual = buildProgram({
    weeks: [
      {
        week_number: 1,
        week_brief: "Invented week brief",
        sessions: [
          {
            day_of_week: "Wed",
            activity_type: "Race",
            raw_text: "Completely different",
            session_role: "Race",
            priority: false,
            optional: false,
            notes: "Invented note",
            intensity: "Hard",
            steps: [],
            optional_alternatives: [],
          },
        ],
      },
    ],
  });

  const score = scoreProgramAgainstGold(expected, {
    guide: "PLAN OVERVIEW\n- 1 week\n- invented extras",
    program: actual,
    latencyMs: 8_000,
    estimatedCostUsd: 0.11,
  });

  assert.ok(score.overall < 0.5);
  assert.ok(score.breakdown.dayAssignment < 1);
  assert.ok(score.breakdown.activityTyping < 1);
  assert.ok(score.breakdown.rawTextPreservation < 1);
  assert.ok(score.breakdown.structureCoverage < 1);
  assert.ok(score.breakdown.nullHandling < 1);
});
