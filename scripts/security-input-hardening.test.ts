import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("change log route validates allowed sources, change types, and JSON payload size", async () => {
  const source = await readWorkspaceFile("src/app/api/plans/[id]/change-log/route.ts");

  assert.match(source, /ALLOWED_CHANGE_LOG_SOURCES/);
  assert.match(source, /ALLOWED_CHANGE_LOG_TYPES/);
  assert.match(source, /MAX_CHANGE_LOG_JSON_BYTES/);
  assert.match(source, /TextEncoder\(\)\.encode\(JSON\.stringify/);
});

test("plan upload route verifies PDF magic bytes instead of trusting browser mime metadata", async () => {
  const source = await readWorkspaceFile("src/app/api/plans/route.ts");

  assert.match(source, /function looksLikePdfBuffer/);
  assert.match(source, /%PDF-/);
  assert.match(source, /Uploaded file must be a valid PDF/);
});

test("template listing route uses typed validated filters instead of an any-typed where object", async () => {
  const source = await readWorkspaceFile("src/app/api/templates/route.ts");

  assert.doesNotMatch(source, /const where: any/);
  assert.match(source, /TrainingPlanWhereInput/);
  assert.match(source, /parseWeeksFilter/);
});

test("upload and strava sync routes no longer depend on the in-memory rate limiter", async () => {
  const plansSource = await readWorkspaceFile("src/app/api/plans/route.ts");
  const stravaSyncSource = await readWorkspaceFile("src/app/api/integrations/strava/sync/route.ts");

  assert.doesNotMatch(plansSource, /rateLimit\(/);
  assert.doesNotMatch(stravaSyncSource, /rateLimit\(/);
  assert.match(plansSource, /planSourceDocument\.count/);
  assert.match(stravaSyncSource, /lastSyncAt/);
});
