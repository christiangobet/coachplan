import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("upload route does not eagerly extract full PDF text before the vision markdown attempt", async () => {
  const source = await readFile(new URL("../src/app/api/plans/route.ts", import.meta.url), "utf8");

  const extractPdfTextIndex = source.indexOf("extractPdfText(buffer)");
  const maybeRunVisionExtractIndex = source.search(/maybeRunVisionExtract\(buffer,\s*plan\.id/);

  assert.ok(maybeRunVisionExtractIndex >= 0, "expected maybeRunVisionExtract call");
  assert.equal(extractPdfTextIndex, -1, "route should not eagerly call extractPdfText(buffer) in the markdown-first upload flow");
});

test("markdown-first parsing uses the deterministic markdown parser before any chunked fallback", async () => {
  const source = await readFile(new URL("../src/lib/ai-plan-parser.ts", import.meta.url), "utf8");

  assert.match(source, /parseMarkdownProgram/);
  assert.match(source, /markdown-session-enricher/);
  assert.doesNotMatch(source, /chunkMd\(planMd,\s*5\)/);
  assert.doesNotMatch(source, /runVisionMdChunkWithRetries/);
});
