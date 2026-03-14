import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("day log card exposes route viewing for synced Strava activities with geometry", async () => {
  const source = await readWorkspaceFile("src/components/DayLogCard.tsx");

  assert.match(source, /View route/);
  assert.match(source, /buildStravaRoutePreview/);
  assert.match(source, /ActivityRouteSheet/);
  assert.match(source, /setSelectedRouteActivityId/);
});
