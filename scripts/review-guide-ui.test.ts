import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("review page loads parse-context and exposes preview/edit guide tabs", async () => {
  const source = await readFile(new URL("../src/app/plans/[id]/review/page.tsx", import.meta.url), "utf8");

  assert.match(source, /\/api\/plans\/\$\{planId\}\/parse-context/);
  assert.match(source, /\/api\/plans\/\$\{planId\}\/parse-context\/backfill/);
  assert.match(source, /Preview/);
  assert.match(source, /Edit Guide/);
  assert.match(source, /Backfill Extracted Markdown/);
  assert.match(source, /Apply Markdown Parse to Plan/);
  assert.match(source, /ReactMarkdown/);
  assert.match(source, /Parsing In Progress/);
  assert.match(source, /Current stage:/);
  assert.doesNotMatch(source, /Enrich Schedule with Current Guide/);
  assert.doesNotMatch(source, /fetch\(`\/api\/plans\/\$\{planId\}\/reparse`,/);
});

test("review page does not reference old chunked-parse specific concepts", async () => {
  const source = await readFile(new URL("../src/app/plans/[id]/review/page.tsx", import.meta.url), "utf8");

  // Old chunk-budget and chunked parse concepts must not leak into the review UI
  assert.doesNotMatch(source, /parseBudgetMs/);
  assert.doesNotMatch(source, /Parse budget exhausted/);
  assert.doesNotMatch(source, /MD chunked/);
  // parse-context API remains the single source of truth for markdown status in review
  assert.match(source, /mdParseStatus/);
});
