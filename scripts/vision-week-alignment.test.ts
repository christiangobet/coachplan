import test from "node:test";
import assert from "node:assert/strict";

import { alignProgramWeeksToExpectedChunk } from "../src/lib/parsing/v4-week-alignment.ts";
import type { ProgramJsonV1 } from "../src/lib/schemas/program-json-v1.ts";

function buildProgram(weekNumbers: number[], planLengthWeeks = 5): ProgramJsonV1 {
  return {
    program: {
      title: "Chunk parse",
      distance_target: "MARATHON",
      plan_length_weeks: planLengthWeeks,
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
    weeks: weekNumbers.map((weekNumber) => ({
      week_number: weekNumber,
      sessions: [
        {
          day_of_week: "Mon",
          activity_type: "Run",
          raw_text: `Week ${weekNumber}`,
          session_role: "Main Session",
          priority: false,
          optional: false,
          notes: null,
          intensity: null,
          steps: [],
          optional_alternatives: [],
        },
      ],
    })),
    quality_checks: {
      weeks_detected: weekNumbers.length,
      missing_days: [],
      anomalies: [],
    },
  };
}

test("alignProgramWeeksToExpectedChunk remaps local chunk week numbers by position", () => {
  const input = buildProgram([1, 2, 3, 4, 5], 5);
  const aligned = alignProgramWeeksToExpectedChunk(input, [6, 7, 8, 9, 10]);

  assert.deepEqual(aligned.weeks.map((week) => week.week_number), [6, 7, 8, 9, 10]);
  assert.equal(aligned.program.plan_length_weeks, 10);
});

test("alignProgramWeeksToExpectedChunk keeps already-aligned week numbers intact", () => {
  const input = buildProgram([16, 17, 18], 3);
  const aligned = alignProgramWeeksToExpectedChunk(input, [16, 17, 18]);

  assert.deepEqual(aligned.weeks.map((week) => week.week_number), [16, 17, 18]);
  assert.equal(aligned.program.plan_length_weeks, 18);
});
