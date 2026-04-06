import test from "node:test";
import assert from "node:assert/strict";

import {
  assessProgramWeekCompleteness,
  buildProgramWeekCompletenessWarning,
} from "../src/lib/parsing/program-week-completeness.ts";
import { parseMarkdownProgram } from "../src/lib/parsing/markdown-program-parser.ts";

test("assessProgramWeekCompleteness accepts contiguous weeks from 1 through plan length", () => {
  const completeness = assessProgramWeekCompleteness({
    program: { plan_length_weeks: 3 },
    weeks: [
      { week_number: 1, sessions: [] },
      { week_number: 2, sessions: [] },
      { week_number: 3, sessions: [] },
    ],
  } as any);

  assert.equal(completeness.isComplete, true);
  assert.deepEqual(completeness.missingWeekNumbers, []);
});

test("assessProgramWeekCompleteness flags missing leading weeks", () => {
  const completeness = assessProgramWeekCompleteness({
    program: { plan_length_weeks: 10 },
    weeks: [
      { week_number: 6, sessions: [] },
      { week_number: 7, sessions: [] },
      { week_number: 8, sessions: [] },
      { week_number: 9, sessions: [] },
      { week_number: 10, sessions: [] },
    ],
  } as any);

  assert.equal(completeness.isComplete, false);
  assert.deepEqual(completeness.missingWeekNumbers, [1, 2, 3, 4, 5]);
});

test("buildProgramWeekCompletenessWarning formats missing week ranges", () => {
  const warning = buildProgramWeekCompletenessWarning({
    program: { plan_length_weeks: 10 },
    weeks: [
      { week_number: 1, sessions: [] },
      { week_number: 2, sessions: [] },
      { week_number: 6, sessions: [] },
      { week_number: 7, sessions: [] },
      { week_number: 10, sessions: [] },
    ],
  } as any);

  assert.ok(warning);
  assert.equal(warning?.missingWeekRangesLabel, "3-5, 8-9");
  assert.match(String(warning?.message), /missing weeks 3-5, 8-9 of expected 1-10/);
});

test("assessProgramWeekCompleteness uses explicit expected week numbers when program metadata underreports total weeks", () => {
  const completeness = assessProgramWeekCompleteness(
    {
      program: { plan_length_weeks: 10 },
      weeks: [
        { week_number: 1, sessions: [] },
        { week_number: 2, sessions: [] },
        { week_number: 3, sessions: [] },
        { week_number: 4, sessions: [] },
        { week_number: 5, sessions: [] },
        { week_number: 6, sessions: [] },
        { week_number: 7, sessions: [] },
        { week_number: 8, sessions: [] },
        { week_number: 9, sessions: [] },
        { week_number: 10, sessions: [] },
      ],
    } as any,
    { expectedWeekNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] },
  );

  assert.equal(completeness.isComplete, false);
  assert.deepEqual(completeness.missingWeekNumbers, [11, 12, 13, 14, 15, 16, 17, 18]);
});

// --- markdown-native parser path integration ---

const WEEK_ROW = (day: string, session: string) =>
  `| ${day} | ${session} | — | — |`;

function makeWeekSection(weekNumber: number): string {
  return [
    `## Week ${weekNumber}`,
    "",
    "| Day | Session | Distance | Duration |",
    "| --- | --- | --- | --- |",
    WEEK_ROW("Mon", "Easy run"),
    WEEK_ROW("Tue", "Rest"),
    WEEK_ROW("Wed", "Tempo run"),
    WEEK_ROW("Thu", "Rest"),
    WEEK_ROW("Fri", "Easy run"),
    WEEK_ROW("Sat", "Long Run 10 miles"),
    WEEK_ROW("Sun", "Rest"),
    "",
  ].join("\n");
}

test("markdown-native parser: rejects partial plan missing leading weeks", async () => {
  // 10-week plan declared in header, only weeks 6-10 present
  const markdown = [
    "# 10-week Training Plan",
    "",
    ...Array.from({ length: 5 }, (_, i) => makeWeekSection(i + 6)),
  ].join("\n");

  const program = await parseMarkdownProgram({ markdown });
  const warning = buildProgramWeekCompletenessWarning(program);

  assert.ok(warning !== null, "expected a completeness warning for missing leading weeks");
  assert.deepEqual(warning?.missingWeekNumbers, [1, 2, 3, 4, 5]);
});

test("markdown-native parser: rejects partial plan with non-contiguous week coverage", async () => {
  // weeks 1-2 and 4-5 present, week 3 missing; plan_length_weeks inferred as 5
  const markdown = [
    "# 5-week Training Plan",
    "",
    makeWeekSection(1),
    makeWeekSection(2),
    makeWeekSection(4),
    makeWeekSection(5),
  ].join("\n");

  const program = await parseMarkdownProgram({ markdown });
  const warning = buildProgramWeekCompletenessWarning(program);

  assert.ok(warning !== null, "expected a completeness warning for missing middle week");
  assert.ok(warning?.missingWeekNumbers.includes(3), "week 3 should be flagged as missing");
});

test("markdown-native parser: accepts complete contiguous plan", async () => {
  const markdown = [
    "# 3-week Training Plan",
    "",
    makeWeekSection(1),
    makeWeekSection(2),
    makeWeekSection(3),
  ].join("\n");

  const program = await parseMarkdownProgram({ markdown });
  const warning = buildProgramWeekCompletenessWarning(program);

  assert.equal(warning, null, "complete plan should not trigger a completeness warning");
});
