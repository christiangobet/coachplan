import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("activity route sheet exposes mobile dialog semantics and route metadata", async () => {
  const source = await readWorkspaceFile("src/components/ActivityRouteSheet.tsx");

  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Imported from Strava/);
  assert.match(source, /Route preview/);
});

test("activity route sheet handles missing geometry gracefully", async () => {
  const source = await readWorkspaceFile("src/components/ActivityRouteSheet.tsx");

  assert.match(source, /Route map unavailable for this activity/);
});
