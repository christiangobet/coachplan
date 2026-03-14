import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("dashboard and calendar activity queries include matched external route data", async () => {
  const dashboardSource = await readWorkspaceFile("src/app/dashboard/page.tsx");
  const calendarSource = await readWorkspaceFile("src/app/calendar/page.tsx");

  assert.match(dashboardSource, /externalActivities:/);
  assert.match(calendarSource, /externalActivities:/);
  assert.match(dashboardSource, /movingTimeSec/);
  assert.match(calendarSource, /movingTimeSec/);
  assert.match(dashboardSource, /elevationGainM/);
  assert.match(calendarSource, /elevationGainM/);
  assert.match(dashboardSource, /raw: true/);
  assert.match(calendarSource, /raw: true/);
});
