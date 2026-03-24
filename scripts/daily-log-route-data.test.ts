import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("dashboard and calendar avoid shipping full raw external payloads in their initial plan queries", async () => {
  const dashboardSource = await readWorkspaceFile("src/app/dashboard/page.tsx");
  const calendarSource = await readWorkspaceFile("src/app/calendar/page.tsx");
  const calendarRawSelections = calendarSource.match(/raw:\s*true/g) ?? [];

  assert.doesNotMatch(dashboardSource, /externalActivities:/);
  assert.doesNotMatch(dashboardSource, /raw:\s*true/);
  assert.match(calendarSource, /externalActivitiesSummary/);
  assert.match(calendarSource, /selectedExternalActivityRows/);
  assert.equal(calendarRawSelections.length, 1);
});
