import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateMarkdownFirstUpload,
  type MarkdownUploadPipelineState,
} from "../src/lib/parsing/markdown-upload-enforcement.ts";
import { parseMarkdownProgram } from "../src/lib/parsing/markdown-program-parser.ts";

function makeState(overrides: Partial<MarkdownUploadPipelineState> = {}): MarkdownUploadPipelineState {
  return {
    hasPdf: true,
    visionEnabled: true,
    visionAttempted: true,
    extractedMd: "# Week 1",
    resultKind: "program",
    finalParser: "vision",
    selectedBaseParser: "vision",
    usedFallback: false,
    usedEnrichers: [],
    candidateRuns: [],
    program: {
      program: { plan_length_weeks: 1 },
      weeks: [{ week_number: 1, sessions: [] }],
      quality_checks: { weeks_detected: 1, missing_days: [], anomalies: [] },
    } as any,
    ...overrides,
  };
}

test("accepts markdown-first uploads when vision produced extracted markdown and final parser is vision", () => {
  const result = evaluateMarkdownFirstUpload(makeState());

  assert.equal(result.ok, true);
  assert.equal(result.status.uploadStatus, "accepted");
  assert.equal(result.status.mdParseStatus, "succeeded");
  assert.equal(result.status.failureReason, null);
});

test("rejects uploads when vision extraction is not enabled", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    visionEnabled: false,
    visionAttempted: false,
    extractedMd: null,
    resultKind: "program",
    finalParser: "v4",
    selectedBaseParser: "v4",
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "vision_not_enabled");
  assert.equal(result.status.mdParseStatus, "missing");
});

test("rejects uploads when extracted markdown was never attempted", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    visionAttempted: false,
    extractedMd: null,
    resultKind: "program",
    finalParser: "v4",
    selectedBaseParser: "v4",
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "extracted_md_not_attempted");
  assert.equal(result.status.mdParseStatus, "missing");
});

test("rejects uploads when extracted markdown is missing after vision attempt", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    extractedMd: null,
    resultKind: "legacy",
    finalParser: "legacy",
    selectedBaseParser: "vision",
    usedFallback: true,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "extracted_md_missing");
  assert.equal(result.status.mdParseStatus, "failed");
});

test("rejects uploads when markdown parse does not produce a program result", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    resultKind: "legacy",
    finalParser: "legacy",
    selectedBaseParser: "vision",
    usedFallback: true,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "markdown_program_missing");
  assert.equal(result.status.mdParseStatus, "failed");
});

test("rejects uploads when final parser is not vision-backed", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    finalParser: "v4",
    selectedBaseParser: "vision",
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "markdown_program_invalid");
  assert.equal(result.status.mdParseStatus, "failed");
});

test("rejects uploads when the markdown-backed program is partial", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    program: {
      program: { plan_length_weeks: 10 },
      weeks: [
        { week_number: 6, sessions: [] },
        { week_number: 7, sessions: [] },
        { week_number: 8, sessions: [] },
        { week_number: 9, sessions: [] },
        { week_number: 10, sessions: [] },
      ],
      quality_checks: { weeks_detected: 5, missing_days: [], anomalies: [] },
    } as any,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "markdown_program_partial");
  assert.equal(result.status.mdParseStatus, "partial");
  assert.deepEqual(result.status.missingWeekNumbers, [1, 2, 3, 4, 5]);
});

test("rejects uploads when the markdown-backed program has a missing middle week", () => {
  const result = evaluateMarkdownFirstUpload(makeState({
    program: {
      program: { plan_length_weeks: 10 },
      weeks: [
        { week_number: 1, sessions: [] },
        { week_number: 2, sessions: [] },
        { week_number: 4, sessions: [] },
        { week_number: 5, sessions: [] },
        { week_number: 6, sessions: [] },
        { week_number: 7, sessions: [] },
        { week_number: 8, sessions: [] },
        { week_number: 9, sessions: [] },
        { week_number: 10, sessions: [] },
      ],
      quality_checks: { weeks_detected: 9, missing_days: [], anomalies: [] },
    } as any,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "markdown_program_partial");
  assert.equal(result.status.mdParseStatus, "partial");
  assert.deepEqual(result.status.missingWeekNumbers, [3]);
});

// --- markdown-native parser path integration ---

const WEEK_ROW_E = (day: string, session: string) =>
  `| ${day} | ${session} | — | — |`;

function makeWeekSectionE(weekNumber: number): string {
  return [
    `## Week ${weekNumber}`,
    "",
    "| Day | Session | Distance | Duration |",
    "| --- | --- | --- | --- |",
    WEEK_ROW_E("Mon", "Easy run"),
    WEEK_ROW_E("Tue", "Rest"),
    WEEK_ROW_E("Sat", "Long Run 10 miles"),
    WEEK_ROW_E("Sun", "Rest"),
    "",
  ].join("\n");
}

test("markdown-native pipeline: evaluateMarkdownFirstUpload rejects partial plan from parseMarkdownProgram", async () => {
  // 10-week plan header, but only weeks 6-10 present in markdown
  const markdown = [
    "# 10-week Training Plan",
    "",
    ...Array.from({ length: 5 }, (_, i) => makeWeekSectionE(i + 6)),
  ].join("\n");

  const program = await parseMarkdownProgram({ markdown });

  const result = evaluateMarkdownFirstUpload(makeState({ program }));

  assert.equal(result.ok, false);
  assert.equal(result.status.failureReason, "markdown_program_partial");
  assert.equal(result.status.mdParseStatus, "partial");
  assert.ok(result.status.missingWeekNumbers.length > 0);
});

test("markdown-native pipeline: evaluateMarkdownFirstUpload accepts complete plan from parseMarkdownProgram", async () => {
  const markdown = [
    "# 3-week Training Plan",
    "",
    makeWeekSectionE(1),
    makeWeekSectionE(2),
    makeWeekSectionE(3),
  ].join("\n");

  const program = await parseMarkdownProgram({ markdown });

  const result = evaluateMarkdownFirstUpload(makeState({ program }));

  assert.equal(result.ok, true);
  assert.equal(result.status.uploadStatus, "accepted");
  assert.equal(result.status.missingWeekNumbers.length, 0);
});
