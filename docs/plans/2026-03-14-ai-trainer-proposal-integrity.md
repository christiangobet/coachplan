# AI Trainer Proposal Integrity Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI Trainer proposals truthful and scoped so rename-only requests do not claim unapplied edits and do not surface unrelated whole-plan warning flags.

**Architecture:** Keep the existing AI adjust pipeline, but harden it at three points: proposal sanitization, risk-flag generation, and user-facing coach copy. The fix should preserve the current proposal/apply contract while ensuring the visible recommendation always matches the surviving change set.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma, Node `node:test`

---

## Root Cause Summary

1. `sanitizeProposalAgainstLockedDays(...)` in `src/lib/plan-editor.ts` removes blocked changes, but keeps the original `coachReply` and usually keeps the original `summary`. That lets the bot say a rename happened even when the rename was stripped because the target day is locked.
2. `scoreProposalCandidate(...)` in `src/app/api/plans/[id]/ai-adjust/route.ts` computes duration-jump diagnostics across the full simulated plan, not just touched weeks or newly introduced risk. That means existing Week 6 or Week 7 load jumps can appear on unrelated requests such as a simple rename.
3. The AI generation prompt in `src/app/api/plans/[id]/ai-adjust/route.ts` asks for `coachReply`, but does not explicitly require future-tense or proposal-tense wording. So even before apply, the bot can speak as if the change is already done.

## Desired Behavior

- If all requested changes are removed because the target is locked, the coach should say that directly and must not claim the plan was changed.
- If some requested changes survive sanitization, the visible summary and coach reply should describe only the surviving changes.
- Rename-only or metadata-only edits must not surface unrelated whole-plan duration-jump warnings from untouched weeks.
- Risk flags should represent proposal-specific risk introduced or worsened by the proposal, not baseline plan issues unless the proposal makes them worse.

---

### Task 1: Lock in the failing behavior with focused tests

**Files:**
- Modify: `src/lib/plan-editor.ts`
- Modify: `src/app/api/plans/[id]/ai-adjust/route.ts`
- Create: `scripts/ai-adjust-proposal-integrity.test.ts`

**Step 1: Write the failing tests**

Cover these cases:
- A proposal with one `edit_activity` rename targeting a locked day is sanitized to zero changes and the resulting visible copy does not say the rename happened.
- A proposal with a rename on an unlocked day preserves the rename copy.
- A rename-only proposal on an unchanged plan with an existing Week 6 or Week 7 duration jump does not emit those duration-jump diagnostics unless the proposal worsens that week.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types scripts/ai-adjust-proposal-integrity.test.ts
```

Expected:
- Failures proving the current sanitize/scoring behavior is too permissive and too global.

**Step 3: Commit**

```bash
git add scripts/ai-adjust-proposal-integrity.test.ts
git commit -m "test: capture ai trainer proposal integrity regressions"
```

---

### Task 2: Make sanitized proposals truthful when locked days remove changes

**Files:**
- Modify: `src/lib/plan-editor.ts`
- Test: `scripts/ai-adjust-proposal-integrity.test.ts`

**Step 1: Add minimal implementation**

Update `sanitizeProposalAgainstLockedDays(...)` so it:
- rewrites `summary` when `removed > 0`
- rewrites `coachReply` when `removed > 0`
- if `nextChanges.length === 0`, clearly says nothing was applied/proposed because completed days are locked
- if some changes remain, states that blocked changes were removed and describes only the remaining recommendation

Prefer deterministic server-side copy over trusting the model’s original wording once the proposal has been materially altered.

**Step 2: Run targeted test**

Run:

```bash
node --test --experimental-strip-types scripts/ai-adjust-proposal-integrity.test.ts
```

Expected:
- The locked-day truthfulness assertions now pass.

**Step 3: Commit**

```bash
git add src/lib/plan-editor.ts scripts/ai-adjust-proposal-integrity.test.ts
git commit -m "fix: rewrite ai proposal copy after lock sanitization"
```

---

### Task 3: Scope invariant diagnostics to proposal impact, not baseline plan noise

**Files:**
- Modify: `src/app/api/plans/[id]/ai-adjust/route.ts`
- Test: `scripts/ai-adjust-proposal-integrity.test.ts`

**Step 1: Write minimal scoring refinement**

Refactor `scoreProposalCandidate(...)` so diagnostics only include:
- week-level issues in touched weeks, or
- issues made worse versus baseline, or
- proposal-introduced structural risks

Specifically for weekly duration jumps:
- compute baseline week-to-week jump flags from `baseWeeks`
- compute proposed jump flags from `weeks`
- only emit a duration-jump diagnostic if the candidate introduces a new flagged jump or worsens a previously flagged jump

Keep unchanged baseline warnings out of `riskFlags` for unrelated requests.

**Step 2: Run targeted test**

Run:

```bash
node --test --experimental-strip-types scripts/ai-adjust-proposal-integrity.test.ts
```

Expected:
- The rename-only duration-jump regression now passes.

**Step 3: Commit**

```bash
git add src/app/api/plans/[id]/ai-adjust/route.ts scripts/ai-adjust-proposal-integrity.test.ts
git commit -m "fix: scope ai proposal risk flags to proposal impact"
```

---

### Task 4: Prevent pre-apply coach copy from sounding already-applied

**Files:**
- Modify: `src/app/api/plans/[id]/ai-adjust/route.ts`
- Optionally modify: `src/app/plans/[id]/page.tsx`
- Test: `scripts/ai-adjust-proposal-integrity.test.ts`

**Step 1: Harden generation-time wording**

Update the AI adjust prompt so `coachReply` is framed as a recommendation, not a completed edit. Add explicit guidance such as:
- describe what you recommend changing
- do not claim the plan was already updated
- avoid phrases like “I updated the plan” before apply

If needed, add a lightweight server-side normalization pass that rewrites obvious past-tense “already changed” phrases when the proposal is still only a recommendation.

**Step 2: Verify UI semantics**

Ensure the live coach card still renders naturally in `src/app/plans/[id]/page.tsx` after copy changes, especially when `proposalState` is still `active`.

**Step 3: Run tests**

Run:

```bash
node --test --experimental-strip-types scripts/ai-adjust-proposal-integrity.test.ts
npm run typecheck
npm run lint
```

Expected:
- Tests pass
- No TypeScript or lint regressions

**Step 4: Commit**

```bash
git add src/app/api/plans/[id]/ai-adjust/route.ts src/app/plans/[id]/page.tsx scripts/ai-adjust-proposal-integrity.test.ts
git commit -m "fix: keep ai trainer recommendations truthful before apply"
```

---

### Task 5: End-to-end verification on the affected flow

**Files:**
- No required code changes

**Step 1: Manual verification scenarios**

Verify on a real athlete plan:
- Request a rename on a completed-day activity.
  Expected: recommendation says it cannot rename because the day is locked.
- Request a rename on an unlocked activity.
  Expected: proposal describes the rename as recommended, not already applied.
- Apply the rename.
  Expected: title changes in plan UI and persists after reload.
- Request an unrelated simple rename on a plan that already contains historical week-duration jumps.
  Expected: no unrelated Week 6 or Week 7 risk flags unless the rename proposal actually affects those weeks.

**Step 2: Final verification**

Run:

```bash
node --test --experimental-strip-types scripts/ai-adjust-proposal-integrity.test.ts
npm run typecheck
npm run lint
```

**Step 3: Commit**

```bash
git add .
git commit -m "fix: harden ai trainer proposal integrity"
```

