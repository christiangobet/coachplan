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

const FULL_MD = [
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
].join("\n");

test("runVisionMdChunkWithRetries succeeds on first attempt — no retries", async () => {
  const chunk: MdChunk = { text: FULL_MD, weekNumbers: [1, 2, 3, 4, 5] };

  const seen: number[][] = [];
  const result = await runVisionMdChunkWithRetries(
    chunk,
    async (currentChunk) => {
      seen.push(currentChunk.weekNumbers);
      return buildProgram(currentChunk.weekNumbers, currentChunk.weekNumbers.length);
    },
  );

  // Only the initial 5-week call should have fired
  assert.deepEqual(seen, [[1, 2, 3, 4, 5]]);
  assert.ok(result);
  assert.equal(result?.weeks.length, 5);
});

test("runVisionMdChunkWithRetries retries only missing weeks individually", async () => {
  const chunk: MdChunk = { text: FULL_MD, weekNumbers: [1, 2, 3, 4, 5] };

  const seen: number[][] = [];
  const result = await runVisionMdChunkWithRetries(
    chunk,
    async (currentChunk) => {
      seen.push(currentChunk.weekNumbers);
      // Full chunk returns only weeks 1-3; single-week retries for 4 and 5 succeed
      if (currentChunk.weekNumbers.length === 5) {
        return buildProgram([1, 2, 3], 3);
      }
      return buildProgram(currentChunk.weekNumbers, 1);
    },
  );

  // Initial attempt + one single-week retry per missing week (4 and 5)
  assert.deepEqual(seen, [[1, 2, 3, 4, 5], [4], [5]]);
  assert.ok(result);
  assert.deepEqual(result?.weeks.map((w) => w.week_number).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("runVisionMdChunkWithRetries returns partial result when some retries fail", async () => {
  const chunk: MdChunk = { text: FULL_MD, weekNumbers: [1, 2, 3, 4, 5] };

  const result = await runVisionMdChunkWithRetries(
    chunk,
    async (currentChunk) => {
      // Full chunk returns weeks 1-3; week 4 retry fails; week 5 retry succeeds
      if (currentChunk.weekNumbers.length === 5) return buildProgram([1, 2, 3], 3);
      if (currentChunk.weekNumbers.includes(4)) return null;
      return buildProgram(currentChunk.weekNumbers, 1);
    },
  );

  assert.ok(result);
  const weekNums = result?.weeks.map((w) => w.week_number).sort((a, b) => a - b);
  assert.deepEqual(weekNums, [1, 2, 3, 5]);
});

test("runVisionMdChunkWithRetries respects AbortSignal — skips retries", async () => {
  const chunk: MdChunk = { text: FULL_MD, weekNumbers: [1, 2, 3, 4, 5] };
  const controller = new AbortController();

  const seen: number[][] = [];
  const result = await runVisionMdChunkWithRetries(
    chunk,
    async (currentChunk) => {
      seen.push(currentChunk.weekNumbers);
      if (currentChunk.weekNumbers.length === 5) {
        // Abort during the initial attempt — retries should not fire
        controller.abort();
        return buildProgram([1, 2, 3], 3);
      }
      return buildProgram(currentChunk.weekNumbers, 1);
    },
    { signal: controller.signal },
  );

  // Only the initial call; retries skipped because signal was aborted
  assert.deepEqual(seen, [[1, 2, 3, 4, 5]]);
  // Should still return whatever the initial parse produced
  assert.ok(result);
});
