import test from "node:test";
import assert from "node:assert/strict";

import { shouldUseChunkedFallback } from "../src/lib/parsing/parser-v4-mode.ts";

test("chunked markdown parses skip the inner V4 chunked fallback", () => {
  assert.equal(
    shouldUseChunkedFallback({ expectedWeekNumbers: [6, 7, 8, 9, 10] }),
    false,
  );
});

test("raw full-plan parses still allow the inner V4 chunked fallback", () => {
  assert.equal(shouldUseChunkedFallback({}), true);
  assert.equal(shouldUseChunkedFallback(undefined), true);
});
