# Audit Auth Refresh Mobile Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one command that refreshes the Playwright signed-in auth state and then immediately runs the mobile audit flow.

**Architecture:** Keep the existing headed auth capture and headless audit capture scripts as the source of truth. Add a tiny shared helper for audit script defaults and variant filtering, then add a wrapper script that runs auth capture first and mobile audit second with the same profile/base URL inputs.

**Tech Stack:** Node scripts, Playwright, npm scripts, Node `node:test`

---

### Task 1: Lock the wrapper and mobile-only behavior with a failing test

**Files:**
- Create: `scripts/audit-mobile-refresh.test.ts`
- Create: `scripts/lib/audit-workflow.ts`

**Step 1: Write the failing test**

Cover:
- default wrapper options target the `default` profile
- wrapper audit args force `mobile` as the only variant
- explicit `profile`, `baseUrl`, `outDir`, and `planId` are forwarded
- invalid variant tokens are ignored when parsing capture variants

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types scripts/audit-mobile-refresh.test.ts
```

Expected:
- FAIL because the helper module does not exist yet

### Task 2: Add the minimal shared helper and mobile-only capture support

**Files:**
- Create: `scripts/lib/audit-workflow.ts`
- Modify: `scripts/capture-audit.mjs`

**Step 1: Write minimal implementation**

Add a small helper that:
- normalizes profile names
- parses a `variants` input into `desktop` / `mobile`
- builds wrapper args for auth capture and mobile audit

Update `capture-audit.mjs` to accept `--variants mobile` and only run the selected capture variants.

**Step 2: Run test to verify it passes**

Run:

```bash
node --test --experimental-strip-types scripts/audit-mobile-refresh.test.ts
```

Expected:
- PASS

### Task 3: Add the one-command wrapper and npm entrypoint

**Files:**
- Create: `scripts/refresh-audit-mobile-session.mjs`
- Modify: `package.json`

**Step 1: Implement the wrapper**

The wrapper should:
- accept `--profile`, `--base-url`, `--start-path`, `--out-dir`, and `--plan-id`
- run `scripts/save-audit-auth-state.mjs`
- then run `scripts/capture-audit.mjs --variants mobile`

**Step 2: Verify the command wiring**

Run:

```bash
node --test --experimental-strip-types scripts/audit-mobile-refresh.test.ts
npm run audit:mobile:refresh-auth -- --help
```

Expected:
- test passes
- wrapper prints usage/help without trying to launch the browser

### Task 4: Final verification

**Files:**
- Modify: `README.md`

**Step 1: Document the new command**

Add a short note under key commands or audit commands explaining how to refresh auth and rerun the mobile audit in one step.

**Step 2: Run final checks**

Run:

```bash
node --test --experimental-strip-types scripts/audit-mobile-refresh.test.ts
npm run lint
npm run typecheck
```

Expected:
- tests pass
- no lint or typecheck regressions
