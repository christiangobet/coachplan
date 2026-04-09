import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("async upload processor does not stop immediately after markdown becomes available", async () => {
  const source = await readFile(
    new URL("../src/lib/parsing/async-upload-processor.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /stage:\s*"markdown_available"[\s\S]*?\n\s*}\s*catch[\s\S]*?\n\s*}\s*\n\s*return;\n\s*}\n\n\s*const existingProgram/,
  );
});
