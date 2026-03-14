import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("dashboard activity log renders a route trigger for workouts with route preview data", async () => {
  const source = await readWorkspaceFile("src/components/DashboardActivityLogCard.tsx");

  assert.match(source, /View route/);
  assert.match(source, /activity\.routePreview\?\.hasRoute/);
  assert.match(source, /setSelectedRouteActivityId/);
});
