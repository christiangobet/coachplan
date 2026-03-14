import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("plan detail page sends the active week context with AI coach requests", async () => {
  const source = await readWorkspaceFile("src/app/plans/[id]/page.tsx");

  assert.match(source, /currentWeekIndex:\s*activeCurrentWeekIndex/);
  assert.match(source, /data\?\.replyMode === 'activity_feedback'/);
});

test("ai adjust route supports a dedicated status_check reply mode", async () => {
  const source = await readWorkspaceFile("src/app/api/plans/[id]/ai-adjust/route.ts");

  assert.match(source, /detectAiCoachIntent/);
  assert.match(source, /replyMode:\s*'status_check'/);
  assert.match(source, /replyMode:\s*'activity_feedback'/);
  assert.match(source, /generateStatusCheckReply/);
  assert.match(source, /generateActivityFeedbackReply/);
});
