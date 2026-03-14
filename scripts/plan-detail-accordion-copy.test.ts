import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("plan detail accordions use clear athlete-facing labels", async () => {
  const source = await readWorkspaceFile("src/app/plans/[id]/page.tsx");

  assert.match(source, /📋 Plan Guide/);
  assert.match(source, /💬 Conversation History/);
  assert.doesNotMatch(source, />Coach History</);
});
