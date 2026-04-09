import test from "node:test";
import assert from "node:assert/strict";

import { resolveUploadAiCandidateTimeoutMs } from "../src/lib/parsing/upload-timeouts.ts";

test("defaults the AI candidate timeout close to the full upload budget", () => {
  assert.equal(resolveUploadAiCandidateTimeoutMs(undefined, 180_000), 180_000);
});

test("respects explicit env overrides above the minimum threshold", () => {
  assert.equal(resolveUploadAiCandidateTimeoutMs("150000", 180_000), 150_000);
});

test("falls back to the budget-aware default when the override is too small", () => {
  assert.equal(resolveUploadAiCandidateTimeoutMs("5000", 180_000), 180_000);
});

test("never exceeds the total upload budget", () => {
  assert.equal(resolveUploadAiCandidateTimeoutMs(undefined, 95_000), 95_000);
});
