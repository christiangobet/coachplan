import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("activity toggle and complete allow both athlete and owner access", async () => {
  const toggleSource = await readWorkspaceFile("src/app/api/activities/[id]/toggle/route.ts");
  const completeSource = await readWorkspaceFile("src/app/api/activities/[id]/complete/route.ts");

  assert.match(toggleSource, /activity\.plan\.athleteId !== user\.id && activity\.plan\.ownerId !== user\.id/);
  assert.match(completeSource, /activity\.plan\.athleteId !== user\.id && activity\.plan\.ownerId !== user\.id/);
});

test("coach assignment requires an existing coach-athlete link for non-self assignment", async () => {
  const source = await readWorkspaceFile("src/app/api/coach/assign/route.ts");

  assert.match(source, /prisma\.coachAthlete\.findUnique/);
  assert.match(source, /coachId_athleteId/);
  assert.match(source, /Linked athlete not found|Coach-athlete link required/);
});

test("template detail route blocks private templates unless owned by the caller", async () => {
  const source = await readWorkspaceFile("src/app/api/templates/[id]/route.ts");

  assert.match(source, /if \(!template\.isPublic && template\.ownerId !== user\.id\)/);
  assert.match(source, /status:\s*403/);
});
