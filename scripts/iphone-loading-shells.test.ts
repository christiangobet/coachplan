import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("calendar route exposes a dedicated loading shell for iPhone navigation", async () => {
  const source = await readWorkspaceFile("src/app/calendar/loading.tsx");

  assert.match(source, /Loading your calendar/i);
  assert.match(source, /cal-loading-page/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
});

test("plan detail route exposes a dedicated loading shell for iPhone navigation", async () => {
  const source = await readWorkspaceFile("src/app/plans/[id]/loading.tsx");

  assert.match(source, /Opening plan details/i);
  assert.match(source, /plan-detail-loading-page/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
});
