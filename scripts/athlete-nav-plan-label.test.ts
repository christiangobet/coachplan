import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("athlete navigation exposes Plan by Week separately from Plans Library", async () => {
  const mobileNavSource = await readWorkspaceFile("src/components/MobileNav.tsx");
  const layoutSource = await readWorkspaceFile("src/app/layout.tsx");
  const headerSource = await readWorkspaceFile("src/components/Header.tsx");

  assert.match(mobileNavSource, /label: 'Plan by Week'/);
  assert.doesNotMatch(mobileNavSource, /label: 'Plans'/);

  assert.match(layoutSource, /href: "\/plans\/:planId", label: "Plan by Week", planOnly: true/);
  assert.match(layoutSource, /href: "\/plans", label: "Plans Library"/);

  assert.match(headerSource, /item\.planOnly && !contextualPlanId/);
  assert.match(headerSource, /item\.href\.replace\(':planId', contextualPlanId\)/);
});
