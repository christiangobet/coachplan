import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("buildLogActivities wires Strava route previews into log activity data", async () => {
  const source = await readWorkspaceFile("src/lib/log-activity.ts");

  assert.match(source, /routePreview: StravaRoutePreview \| null/);
  assert.match(source, /buildStravaRoutePreview\(/);
  assert.match(source, /Array\.isArray\(activity\.externalActivities\)/);
});
