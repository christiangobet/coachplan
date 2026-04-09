import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("parse debug page renders upload pipeline status artifacts", async () => {
  const source = await readFile(new URL("../src/app/admin/parse-debug/page.tsx", import.meta.url), "utf8");

  assert.match(source, /UPLOAD_PIPELINE_STATUS/);
  assert.match(source, /uploadStatus/i);
  assert.match(source, /failureReason/i);
  assert.match(source, /visionAttempted/i);
  assert.match(source, /hasExtractedMd/i);
  assert.match(source, /mdParseStatus/i);
  assert.match(source, /missingWeekNumbers/i);
});
