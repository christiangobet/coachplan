import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LEGACY_PATCH_ROUTE = path.join(ROOT, "src/app/api/admin/parser-rules/patch/route.ts");
const PATCH_WORKBENCH_ROUTE = path.join(ROOT, "src/app/api/admin/parser-rules/patch-workbench/route.ts");
const PATCH_WORKBENCH_HELPER = path.join(ROOT, "src/lib/parser-rules/patch-workbench.ts");

const ARTIFACT_FILENAMES = [
  "evidence-ledger.json",
  "issue-clusters.json",
  "patch-candidates.json",
  "patch-review.json",
  "patch-eval.json",
  "final-adjustment-bundle.json",
];

function readSource(filePath: string) {
  return readFileSync(filePath, "utf8");
}

test("parser-rules patch workbench contract is scaffolded", () => {
  assert.equal(existsSync(PATCH_WORKBENCH_ROUTE), true, "expected dedicated patch-workbench API route");
  assert.equal(existsSync(PATCH_WORKBENCH_HELPER), true, "expected parser-rules workbench helper module");

  const legacySource = readSource(LEGACY_PATCH_ROUTE);
  const routeSource = readSource(PATCH_WORKBENCH_ROUTE);
  const helperSource = readSource(PATCH_WORKBENCH_HELPER);

  assert.match(routeSource, /export\s+async\s+function\s+GET\b/, "expected GET handler in patch-workbench route");
  assert.match(routeSource, /export\s+async\s+function\s+POST\b/, "expected POST handler in patch-workbench route");

  assert.match(helperSource, /PATCH_WORKBENCH_ARTIFACT_DIR/, "expected artifact directory export");

  for (const artifact of ARTIFACT_FILENAMES) {
    assert.ok(
      routeSource.includes(artifact) || helperSource.includes(artifact),
      `expected artifact reference for ${artifact}`,
    );
  }

  assert.ok(
    legacySource.includes("patch-workbench"),
    "expected legacy patch route to acknowledge the new patch-workbench entrypoint",
  );
});
