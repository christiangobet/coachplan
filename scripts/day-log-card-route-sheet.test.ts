import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("day log card auto-renders an inline route map for synced Strava activities with geometry", async () => {
  const source = await readWorkspaceFile("src/components/DayLogCard.tsx");

  assert.match(source, /RouteMap/);
  assert.match(source, /day-log-inline-route/);
  assert.match(source, /buildStravaRoutePreview/);
  assert.match(source, /primaryRoutePreview/);
  assert.doesNotMatch(source, /View route/);
});
