import test from "node:test";
import assert from "node:assert/strict";

import { buildCombinedGuideMarkdown, buildParseContextSummary, selectLatestExtractedMd } from "../src/lib/plan-parse-context.ts";

function makeProgram(weekNumbers: number[], planLengthWeeks = weekNumbers[weekNumbers.length - 1] ?? 1) {
  return {
    program: {
      title: "Plan",
      plan_length_weeks: planLengthWeeks,
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
      sessions: [],
    })),
    quality_checks: {
      weeks_detected: weekNumbers.length,
      missing_days: [],
      anomalies: [],
    },
  };
}

test("selectLatestExtractedMd picks the newest valid extracted markdown artifact", () => {
  const selected = selectLatestExtractedMd([
    {
      id: "job_newest",
      createdAt: "2026-04-05T11:00:00.000Z",
      artifacts: [
        {
          artifactType: "EXTRACTED_MD",
          validationOk: true,
          createdAt: "2026-04-05T11:00:05.000Z",
          json: { md: "# Week 1\n\nModern markdown" },
        },
      ],
    },
    {
      id: "job_older",
      createdAt: "2026-04-05T10:00:00.000Z",
      artifacts: [
        {
          artifactType: "EXTRACTED_MD",
          validationOk: true,
          createdAt: "2026-04-05T10:00:05.000Z",
          json: { md: "# Week 1\n\nOlder markdown" },
        },
      ],
    },
  ]);

  assert.equal(selected.parseJobId, "job_newest");
  assert.equal(selected.extractedMd, "# Week 1\n\nModern markdown");
});

test("selectLatestExtractedMd ignores unrelated or empty artifacts", () => {
  const selected = selectLatestExtractedMd([
    {
      id: "job_1",
      createdAt: "2026-04-05T11:00:00.000Z",
      artifacts: [
        {
          artifactType: "V4_OUTPUT",
          validationOk: true,
          createdAt: "2026-04-05T11:00:05.000Z",
          json: {},
        },
      ],
    },
    {
      id: "job_2",
      createdAt: "2026-04-05T10:00:00.000Z",
      artifacts: [
        {
          artifactType: "EXTRACTED_MD",
          validationOk: true,
          createdAt: "2026-04-05T10:00:05.000Z",
          json: { md: "   " },
        },
      ],
    },
  ]);

  assert.equal(selected.parseJobId, null);
  assert.equal(selected.extractedMd, null);
});

test("buildCombinedGuideMarkdown includes both sections and empty states", () => {
  const combined = buildCombinedGuideMarkdown(null, "# Week 1\n\n| Day | Session |");

  assert.match(combined, /^# Plan Context Guide/m);
  assert.match(combined, /_No guide yet\._/);
  assert.match(combined, /^# Extracted Training Plan Markdown/m);
  assert.match(combined, /\| Day \| Session \|/);
});

test("buildParseContextSummary reports markdown-backed status and persistence source", () => {
  const summary = buildParseContextSummary({
    jobs: [
      {
        id: "job_vision",
        parserVersion: "vision-v1",
        status: "SUCCESS",
        createdAt: "2026-04-05T11:00:00.000Z",
        artifacts: [
          {
            artifactType: "EXTRACTED_MD",
            validationOk: true,
            createdAt: "2026-04-05T11:00:05.000Z",
            json: { md: "# Week 1\n\nModern markdown" },
          },
          {
            artifactType: "V4_OUTPUT",
            validationOk: true,
            createdAt: "2026-04-05T11:00:10.000Z",
            json: makeProgram([1], 1),
          },
        ],
      },
    ],
    parseProfile: {
      parser_pipeline: {
        persistence_source: "markdown-primary",
      },
    },
    hasSourceDocument: true,
  });

  assert.equal(summary.hasExtractedMd, true);
  assert.equal(summary.mdParseStatus, "succeeded");
  assert.equal(summary.persistenceSource, "markdown-primary");
  assert.equal(summary.canBackfillExtractedMd, false);
});

test("buildParseContextSummary marks missing markdown as backfillable when a source PDF exists", () => {
  const summary = buildParseContextSummary({
    jobs: [],
    parseProfile: null,
    hasSourceDocument: true,
  });

  assert.equal(summary.hasExtractedMd, false);
  assert.equal(summary.mdParseStatus, "missing");
  assert.equal(summary.canBackfillExtractedMd, true);
  assert.equal(summary.persistenceSource, null);
});

test("buildParseContextSummary exposes apply state when markdown parse succeeded but legacy persistence still owns the plan", () => {
  const summary = buildParseContextSummary({
    jobs: [
      {
        id: "job_vision",
        parserVersion: "vision-v1",
        status: "SUCCESS",
        createdAt: "2026-04-05T11:00:00.000Z",
        artifacts: [
          {
            artifactType: "EXTRACTED_MD",
            validationOk: true,
            createdAt: "2026-04-05T11:00:05.000Z",
            json: { md: "# Week 1\n\nModern markdown" },
          },
          {
            artifactType: "V4_OUTPUT",
            validationOk: true,
            createdAt: "2026-04-05T11:00:10.000Z",
            json: makeProgram([1], 1),
          },
        ],
      },
    ],
    parseProfile: {
      parser_pipeline: {
        persistence_source: "legacy-fallback",
      },
    },
    hasSourceDocument: true,
  });

  assert.equal(summary.mdParseStatus, "succeeded");
  assert.equal(summary.canApplyMdProgram, true);
  assert.equal(summary.canBackfillExtractedMd, false);
});

test("buildParseContextSummary marks partial markdown parses and exposes missing weeks", () => {
  const summary = buildParseContextSummary({
    jobs: [
      {
        id: "job_partial",
        parserVersion: "vision-v1",
        status: "FAILED",
        createdAt: "2026-04-05T11:00:00.000Z",
        artifacts: [
          {
            artifactType: "EXTRACTED_MD",
            validationOk: true,
            createdAt: "2026-04-05T11:00:05.000Z",
            json: { md: "# Week 1\n\nModern markdown" },
          },
          {
            artifactType: "V4_OUTPUT",
            validationOk: false,
            createdAt: "2026-04-05T11:00:10.000Z",
            json: makeProgram([6, 7, 8, 9, 10], 10),
          },
        ],
      },
    ],
    parseProfile: {
      parser_pipeline: {
        persistence_source: "existing-plan-fallback",
      },
    },
    hasSourceDocument: true,
  });

  assert.equal(summary.mdParseStatus, "partial");
  assert.deepEqual(summary.missingWeekNumbers, [1, 2, 3, 4, 5]);
  assert.equal(summary.canApplyMdProgram, false);
});

test("buildParseContextSummary exposes async upload processing state", () => {
  const summary = buildParseContextSummary({
    jobs: [
      {
        id: "job_upload",
        parserVersion: "upload-async",
        status: "RUNNING",
        createdAt: "2026-04-05T11:00:00.000Z",
        artifacts: [
          {
            artifactType: "UPLOAD_PIPELINE_STATUS",
            validationOk: true,
            createdAt: "2026-04-05T11:00:10.000Z",
            json: {
              status: "processing",
              stage: "extracting_markdown",
              planId: "plan_1",
              failureReason: null,
              hasExtractedMd: false,
              extractedMdAvailable: false,
              completedPlanId: null,
            },
          },
        ],
      },
    ],
    parseProfile: null,
    hasSourceDocument: true,
  });

  assert.equal(summary.uploadStatus, "processing");
  assert.equal(summary.uploadStage, "extracting_markdown");
  assert.equal(summary.uploadFailureReason, null);
});

// --- markdown-native parser path integration ---

test("buildParseContextSummary reports parsing_markdown stage during markdown-native parse in progress", () => {
  // Upload job in RUNNING state, markdown extracted, now parsing deterministically
  const summary = buildParseContextSummary({
    jobs: [
      {
        id: "job_upload",
        parserVersion: "upload-async",
        status: "RUNNING",
        createdAt: "2026-04-05T11:00:00.000Z",
        artifacts: [
          {
            artifactType: "UPLOAD_PIPELINE_STATUS",
            validationOk: true,
            createdAt: "2026-04-05T11:00:30.000Z",
            json: {
              status: "processing",
              stage: "parsing_markdown",
              planId: "plan_1",
              failureReason: null,
              hasExtractedMd: true,
              extractedMdAvailable: true,
              completedPlanId: null,
            },
          },
        ],
      },
    ],
    parseProfile: null,
    hasSourceDocument: true,
  });

  assert.equal(summary.uploadStatus, "processing");
  assert.equal(summary.uploadStage, "parsing_markdown");
  assert.equal(summary.uploadFailureReason, null);
});

test("buildParseContextSummary transitions to completed with markdown-primary source after markdown-native parse", () => {
  // Upload completed, plan persisted via markdown-primary
  const summary = buildParseContextSummary({
    jobs: [
      {
        id: "job_vision",
        parserVersion: "vision-v1",
        status: "SUCCESS",
        createdAt: "2026-04-05T11:01:00.000Z",
        artifacts: [
          {
            artifactType: "EXTRACTED_MD",
            validationOk: true,
            createdAt: "2026-04-05T11:01:05.000Z",
            json: { md: "# Week 1\n\n| Day | Session |\n| Mon | Easy run |" },
          },
          {
            artifactType: "V4_OUTPUT",
            validationOk: true,
            createdAt: "2026-04-05T11:01:10.000Z",
            json: makeProgram([1, 2, 3], 3),
          },
        ],
      },
      {
        id: "job_upload",
        parserVersion: "upload-async",
        status: "SUCCESS",
        createdAt: "2026-04-05T11:00:00.000Z",
        artifacts: [
          {
            artifactType: "UPLOAD_PIPELINE_STATUS",
            validationOk: true,
            createdAt: "2026-04-05T11:01:15.000Z",
            json: {
              status: "completed",
              stage: "completed",
              planId: "plan_1",
              failureReason: null,
              hasExtractedMd: true,
              extractedMdAvailable: true,
              completedPlanId: "plan_1",
            },
          },
        ],
      },
    ],
    parseProfile: {
      parser_pipeline: {
        persistence_source: "markdown-primary",
      },
    },
    hasSourceDocument: true,
  });

  assert.equal(summary.uploadStatus, "completed");
  assert.equal(summary.mdParseStatus, "succeeded");
  assert.equal(summary.persistenceSource, "markdown-primary");
  assert.equal(summary.hasExtractedMd, true);
  // markdown-primary plan should not offer re-apply (already applied)
  assert.equal(summary.canApplyMdProgram, false);
});
