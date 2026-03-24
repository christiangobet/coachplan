import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("mobile nav suppresses blanket eager prefetch and prepares routes on touch intent", async () => {
  const source = await readWorkspaceFile("src/components/MobileNav.tsx");

  assert.doesNotMatch(source, /TABS\.forEach\(\(tab\) => router\.prefetch/);
  assert.match(source, /prefetch=\{false\}/);
  assert.match(source, /onTouchStart=/);
});

test("profile bootstraps initial data through one endpoint and defers performance snapshot work", async () => {
  const pageSource = await readWorkspaceFile("src/app/profile/page.tsx");
  const routeSource = await readWorkspaceFile("src/app/api/profile/bootstrap/route.ts");

  assert.match(pageSource, /fetch\('\/api\/profile\/bootstrap'/);
  assert.match(pageSource, /IntersectionObserver|requestIdleCallback/);
  assert.match(routeSource, /coaches/);
  assert.match(routeSource, /stats/);
  assert.match(routeSource, /integrations/);
});

test("strava review loading can target a single day and day log requests pass the date filter", async () => {
  const routeSource = await readWorkspaceFile("src/app/api/integrations/strava/review/route.ts");
  const dayLogCardSource = await readWorkspaceFile("src/components/DayLogCard.tsx");

  assert.match(routeSource, /searchParams\.get\('date'\)/);
  assert.match(routeSource, /requestedDateKey/);
  assert.match(dayLogCardSource, /review\?plan=\$\{encodeURIComponent\(planId\)\}&date=\$\{encodeURIComponent\(dateISO\)\}/);
});

test("plan detail defers heavy extras and uses focus-based mobile refresh", async () => {
  const source = await readWorkspaceFile("src/app/plans/[id]/page.tsx");

  assert.match(source, /dynamic\(\(\) => import\('@\/components\/PlanSourcePdfPane'\)/);
  assert.match(source, /dynamic\(\(\) => import\('@\/components\/PlanGuidePanel'\)/);
  assert.match(source, /if \(!chatOpen && !conversationHistoryOpen\) return;/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /window\.addEventListener\('focus'/);
});
