import test from "node:test";
import assert from "node:assert/strict";

const moduleHref = new URL("../src/lib/parsing/upload-candidate-runner.ts", import.meta.url).href;

test("runTimedUploadCandidate returns the parser result unchanged when it completes in time", async () => {
  const { runTimedUploadCandidate } = await import(moduleHref);

  const result = await runTimedUploadCandidate({
    parser: "vision",
    kind: "program",
    timeoutMs: 200,
    timeoutMessage: "candidate timed out",
    run: async () => ({
      parser: "vision",
      kind: "program",
      viable: true,
      quality: {
        score: 88,
        weekCount: 17,
        dayCoverage: 1,
        notesCoverage: 0.8,
        structureCoverage: 0.6,
        sessionCount: 90,
      },
      data: { weeks: [] } as never,
      warning: null,
    }),
  });

  assert.equal(result.viable, true);
  assert.equal(result.quality.score, 88);
  assert.equal(result.warning, null);
});

test("runTimedUploadCandidate degrades a hung parser to a non-viable result and runs timeout cleanup", async () => {
  const { runTimedUploadCandidate } = await import(moduleHref);

  let cleanupCalls = 0;

  const result = await runTimedUploadCandidate({
    parser: "vision",
    kind: "program",
    timeoutMs: 25,
    timeoutMessage: "vision timed out",
    onTimeout: async () => {
      cleanupCalls += 1;
    },
    run: async () => await new Promise(() => {}),
  });

  assert.equal(result.viable, false);
  assert.equal(result.kind, "program");
  assert.equal(result.data, null);
  assert.equal(result.warning, "vision timed out");
  assert.equal(cleanupCalls, 1);
});

test("runTimedUploadCandidate returns a legacy-shaped failure result when the legacy parser times out", async () => {
  const { runTimedUploadCandidate } = await import(moduleHref);

  const result = await runTimedUploadCandidate({
    parser: "legacy",
    kind: "legacy",
    timeoutMs: 25,
    timeoutMessage: "legacy timed out",
    run: async () => await new Promise(() => {}),
  });

  assert.equal(result.viable, false);
  assert.equal(result.kind, "legacy");
  assert.equal(result.data, null);
  assert.equal(result.quality.weekCount, 0);
  assert.equal(result.warning, "legacy timed out");
});
