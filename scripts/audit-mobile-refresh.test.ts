import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMobileAuditRefreshPlan,
  getAuditNavigationWaitUntil,
  parseAuditVariants,
} from "./lib/audit-workflow.mjs";

test("buildMobileAuditRefreshPlan uses mobile-only audit defaults", () => {
  const plan = buildMobileAuditRefreshPlan({});

  assert.equal(plan.profile, "default");
  assert.deepEqual(plan.authArgs, []);
  assert.deepEqual(plan.auditArgs, ["--variants", "mobile"]);
});

test("buildMobileAuditRefreshPlan forwards explicit wrapper options", () => {
  const plan = buildMobileAuditRefreshPlan({
    profile: "Onboarding Athlete",
    baseUrl: "http://localhost:4000",
    startPath: "/sign-up",
    outDir: "artifacts/custom-audit",
    planId: "plan_123",
  });

  assert.equal(plan.profile, "onboarding-athlete");
  assert.deepEqual(plan.authArgs, [
    "--profile",
    "onboarding-athlete",
    "--base-url",
    "http://localhost:4000",
    "--start-path",
    "/sign-up",
  ]);
  assert.deepEqual(plan.auditArgs, [
    "--profile",
    "onboarding-athlete",
    "--base-url",
    "http://localhost:4000",
    "--out-dir",
    "artifacts/custom-audit",
    "--plan-id",
    "plan_123",
    "--variants",
    "mobile",
  ]);
});

test("parseAuditVariants keeps supported tokens and drops invalid ones", () => {
  assert.deepEqual(parseAuditVariants(undefined), ["desktop", "mobile"]);
  assert.deepEqual(parseAuditVariants("mobile"), ["mobile"]);
  assert.deepEqual(parseAuditVariants("desktop,mobile"), ["desktop", "mobile"]);
  assert.deepEqual(parseAuditVariants("mobile,tablet,desktop,desktop"), ["mobile", "desktop"]);
  assert.deepEqual(parseAuditVariants("tablet"), ["desktop", "mobile"]);
});

test("getAuditNavigationWaitUntil avoids dev-server networkidle hangs", () => {
  assert.equal(getAuditNavigationWaitUntil(), "domcontentloaded");
});
