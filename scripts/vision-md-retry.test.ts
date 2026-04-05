import test from "node:test";
import assert from "node:assert/strict";

import { runVisionMdChunkWithRetries } from "../src/lib/parsing/vision-md-retry.ts";
import type { MdChunk } from "../src/lib/parsing/md-chunker.ts";
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

test("runVisionMdChunkWithRetries retries failed 5-week chunks as smaller subchunks", async () => {
  const chunk: MdChunk = {
    text: [
      "## Glossary",
      "",
      "Context",
      "",
      "## Week 1",
      "A",
      "",
      "## Week 2",
      "B",
      "",
      "## Week 3",
      "C",
      "",
      "## Week 4",
      "D",
      "",
      "## Week 5",
      "E",
    ].join("\n"),
    weekNumbers: [1, 2, 3, 4, 5],
  };

  const seen: number[][] = [];
  const result = await runVisionMdChunkWithRetries(
    chunk,
    async (currentChunk) => {
      seen.push(currentChunk.weekNumbers);
      if (currentChunk.weekNumbers.length === 5) {
        return null;
      }
      return buildProgram(currentChunk.weekNumbers.map((_, index) => index + 1), currentChunk.weekNumbers.length);
    },
    [3, 2, 1],
  );

  assert.deepEqual(seen, [[1, 2, 3, 4, 5], [1, 2, 3], [4, 5]]);
  assert.ok(result);
  assert.deepEqual(result?.weeks.map((week) => week.week_number), [1, 2, 3, 4, 5]);
});
