import test from "node:test";
import assert from "node:assert/strict";

import { buildCombinedGuideMarkdown, buildParseContextSummary, selectLatestExtractedMd } from "../src/lib/plan-parse-context.ts";

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
            json: { weeks: [{ week_number: 1 }] },
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
            json: { weeks: [{ week_number: 1 }] },
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
