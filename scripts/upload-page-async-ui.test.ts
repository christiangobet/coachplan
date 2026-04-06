import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("upload page uses async upload-start polling flow with extracted markdown preview", async () => {
  const source = await readFile(new URL("../src/app/upload/page.tsx", import.meta.url), "utf8");

  assert.match(source, /\/api\/plans\/upload-start/);
  assert.match(source, /\/api\/plans\/uploads\/\$\{uploadId\}\/status/);
  assert.match(source, /\/api\/plans\/uploads\/\$\{uploadId\}\/extracted-md/);
  assert.match(source, /Extracted Training Plan Markdown/);
  assert.match(source, /ReactMarkdown/);
  assert.doesNotMatch(source, /fetch\('\/api\/plans'/);
});

test("upload page defines parsing_markdown stage for markdown-native parse lifecycle", async () => {
  const source = await readFile(new URL("../src/app/upload/page.tsx", import.meta.url), "utf8");

  // The markdown-native parser uses a parsing_markdown stage in the upload lifecycle
  assert.match(source, /parsing_markdown/);
  // Stage should have a human-readable title and detail
  assert.match(source, /Parsing markdown into plan data/);
});

test("upload page humanizes markdown-native failure reasons for the user", async () => {
  const source = await readFile(new URL("../src/app/upload/page.tsx", import.meta.url), "utf8");

  // Upload page must handle markdown_program_missing failure reason (new primary failure mode)
  assert.match(source, /markdown_program_missing/);
  // Old chunk-budget-specific language must not leak into user-facing strings
  assert.doesNotMatch(source, /Parse budget exhausted/);
  assert.doesNotMatch(source, /parseBudgetMs/);
});
