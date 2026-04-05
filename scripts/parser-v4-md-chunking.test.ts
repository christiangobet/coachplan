import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isSinglePassIncomplete } from "../src/lib/parsing/v4-completeness.ts";
import type { ProgramJsonV1 } from "../src/lib/schemas/program-json-v1.ts";

function buildProgramWithWeeks(weekNumbers: number[], declaredPlanLengthWeeks: number): ProgramJsonV1 {
  return {
    program: {
      title: "Chunked plan",
      distance_target: "MARATHON",
      plan_length_weeks: declaredPlanLengthWeeks,
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
          raw_text: `Week ${weekNumber} easy run`,
          session_role: "Easy Run",
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

test("chunk-local completeness does not treat a bounded markdown chunk as incomplete", async () => {
  const single = {
    truncated: false,
    validated: true,
    data: buildProgramWithWeeks([6, 7, 8, 9, 10], 18),
  };

  assert.equal(
    isSinglePassIncomplete(single, undefined, [6, 7, 8, 9, 10]),
    false,
  );
});

test("vision markdown pipeline passes chunk week numbers into Parser V4", async () => {
  const source = await readFile(
    new URL("../src/lib/ai-plan-parser.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /expectedWeekNumbers:\s*retryChunk\.weekNumbers/);
});
