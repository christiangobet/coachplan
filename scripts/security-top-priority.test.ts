import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("middleware protects every non-public route and fails closed when Clerk is unavailable", async () => {
  const source = await readWorkspaceFile("src/middleware.ts");

  assert.match(source, /const isPublicRoute = createRouteMatcher/);
  assert.match(source, /if \(!isPublicRoute\(req\)\) \{\s*await auth\.protect\(\);/);
  assert.match(source, /status:\s*503/);
  assert.doesNotMatch(source, /if \(isAdminRoute\(req\)\)/);
});

test("debug auth route is no longer public", async () => {
  const source = await readWorkspaceFile("src/app/api/debug-auth/route.ts");

  assert.match(source, /requireRoleApi\('ADMIN'\)/);
  assert.match(source, /if \(!access\.ok\)/);
});

test("api me route does not accept role escalation fields and only returns a safe profile payload", async () => {
  const source = await readWorkspaceFile("src/app/api/me/route.ts");

  assert.doesNotMatch(source, /role:\s*body\.role/);
  assert.doesNotMatch(source, /currentRole:\s*body\.role/);
  assert.doesNotMatch(source, /hasBothRoles:\s*body\.hasBothRoles/);
  assert.match(source, /SAFE_USER_RESPONSE_SELECT/);
  assert.doesNotMatch(source, /NextResponse\.json\(dbUser\)/);
});

test("strava webhook fails closed unless the documented subscription id guard is configured", async () => {
  const source = await readWorkspaceFile("src/app/api/integrations/strava/webhook/route.ts");

  assert.match(source, /STRAVA_WEBHOOK_SUBSCRIPTION_ID is not configured/);
  assert.match(source, /content-type/);
  assert.match(source, /status:\s*503/);
});
