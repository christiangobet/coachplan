import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("strava review payload includes route geometry fields for synced activity details", async () => {
  const source = await readWorkspaceFile("src/app/api/integrations/strava/review/route.ts");

  assert.match(source, /movingTimeSec/);
  assert.match(source, /elevationGainM/);
  assert.match(source, /raw: external\.raw/);
});
