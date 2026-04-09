import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUploadStatusSummary,
  type UploadLifecycleArtifactLike,
  type UploadLifecycleJobLike,
} from "../src/lib/upload-progress.ts";

function makeJob(overrides: Partial<UploadLifecycleJobLike> = {}): UploadLifecycleJobLike {
  return {
    id: "upload_job_1",
    planId: "plan_1",
    status: "RUNNING",
    createdAt: "2026-04-05T12:00:00.000Z",
    errorMessage: null,
    artifacts: [],
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<UploadLifecycleArtifactLike> = {}): UploadLifecycleArtifactLike {
  return {
    artifactType: "UPLOAD_PIPELINE_STATUS",
    validationOk: true,
    createdAt: "2026-04-05T12:00:05.000Z",
    json: {
      status: "processing",
      stage: "queued",
      failureReason: null,
      hasExtractedMd: false,
      extractedMdAvailable: false,
      completedPlanId: null,
    },
    ...overrides,
  };
}

test("buildUploadStatusSummary reports queued jobs before markdown is available", () => {
  const summary = buildUploadStatusSummary({
    job: makeJob({
      artifacts: [
        makeArtifact(),
      ],
    }),
    extractedMd: null,
  });

  assert.equal(summary.status, "processing");
  assert.equal(summary.stage, "queued");
  assert.equal(summary.hasExtractedMd, false);
  assert.equal(summary.extractedMdAvailable, false);
  assert.equal(summary.failureReason, null);
});

test("buildUploadStatusSummary reports markdown_available when extracted markdown exists mid-pipeline", () => {
  const summary = buildUploadStatusSummary({
    job: makeJob({
      artifacts: [
        makeArtifact({
          createdAt: "2026-04-05T12:01:00.000Z",
          json: {
            status: "processing",
            stage: "markdown_available",
            failureReason: null,
            hasExtractedMd: true,
            extractedMdAvailable: true,
            completedPlanId: null,
          },
        }),
      ],
    }),
    extractedMd: "# Week 1\n\n| Day | Session |",
  });

  assert.equal(summary.status, "processing");
  assert.equal(summary.stage, "markdown_available");
  assert.equal(summary.hasExtractedMd, true);
  assert.equal(summary.extractedMdAvailable, true);
  assert.equal(summary.extractedMdPreview, "# Week 1\n\n| Day | Session |");
});

test("buildUploadStatusSummary preserves extracted markdown visibility even when final parse fails", () => {
  const summary = buildUploadStatusSummary({
    job: makeJob({
      status: "FAILED",
      errorMessage: "markdown_program_missing",
      artifacts: [
        makeArtifact({
          createdAt: "2026-04-05T12:02:00.000Z",
          json: {
            status: "failed",
            stage: "failed",
            failureReason: "markdown_program_missing",
            hasExtractedMd: true,
            extractedMdAvailable: true,
            completedPlanId: null,
          },
        }),
      ],
    }),
    extractedMd: "# Week 1\n\nStill useful markdown",
  });

  assert.equal(summary.status, "failed");
  assert.equal(summary.stage, "failed");
  assert.equal(summary.failureReason, "markdown_program_missing");
  assert.equal(summary.hasExtractedMd, true);
  assert.equal(summary.extractedMdAvailable, true);
});
