# Parser Rules Patch Workbench Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the one-shot parser-rules patch suggestion flow with an iterative, evidence-backed workbench that consumes all saved per-PDF analysis files, streams progress to the admin UI, and produces a reviewed final adjustment bundle.

**Architecture:** Add a dedicated parser-rules workbench module that builds a normalized evidence ledger from `scripts/parser-analysis/`, runs staged cluster/draft/critique/eval passes, persists intermediate artifacts, and exposes the workflow through a new streaming API route plus a resumable read route. Update the admin UI to drive the new workbench, show live stage progress, and review only the final adjustment bundle with supporting evidence.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Node test scripts, existing OpenAI chat-completions integration, NDJSON streaming helpers, filesystem JSON artifacts.

---

### Task 1: Document the workbench contract in a failing regression test

**Files:**
- Create: `scripts/parser-rules-patch-workbench.test.ts`
- Modify: `src/app/api/admin/parser-rules/patch/route.ts`
- Create: `src/app/api/admin/parser-rules/patch-workbench/route.ts`
- Create: `src/lib/parser-rules/patch-workbench.ts`

**Step 1: Write the failing test**

Create a source-level Node test that asserts the repo contains:

- a dedicated `patch-workbench` API route
- a parser-rules workbench helper module
- artifact names:
  - `evidence-ledger.json`
  - `issue-clusters.json`
  - `patch-candidates.json`
  - `patch-review.json`
  - `patch-eval.json`
  - `final-adjustment-bundle.json`
- the legacy patch route is no longer the only prompt-adjustment entrypoint

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the new route, helper, and artifact references do not exist yet.

**Step 3: Write minimal implementation**

Add skeletal files and exported constants for:

- workbench artifact directory and filenames
- route placeholders for `GET` and `POST`
- a minimal helper module with named stage stubs

Keep the implementation shallow. The goal is to establish the contract surface, not the full workflow yet.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts src/app/api/admin/parser-rules/patch-workbench/route.ts src/lib/parser-rules/patch-workbench.ts src/app/api/admin/parser-rules/patch/route.ts
git commit -m "test: scaffold parser-rules patch workbench contract"
```

### Task 2: Build the evidence ledger from all saved per-PDF analyses

**Files:**
- Modify: `src/lib/parser-rules/patch-workbench.ts`
- Test: `scripts/parser-rules-patch-workbench.test.ts`

**Step 1: Write the failing test**

Extend the test to assert the workbench helper:

- reads every `*.json` file in `scripts/parser-analysis/` except `aggregate.json`
- defines an evidence-ledger builder
- flattens:
  - `unhandled_patterns`
  - `prompt_improvements`
  - `new_abbreviations`
  - notable `sessions_sample` parsing notes
- assigns stable `evidence_id` values

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the evidence-ledger logic is still stubbed.

**Step 3: Write minimal implementation**

In `src/lib/parser-rules/patch-workbench.ts`:

- add typed structures for plan entries, evidence rows, and ledger stats
- implement a reader that loads the saved analysis corpus
- normalize the corpus into a ledger object
- persist `evidence-ledger.json` into `scripts/parser-analysis/patch-workbench/`

Keep this stage deterministic and filesystem-driven. Do not use the LLM here.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts src/lib/parser-rules/patch-workbench.ts
git commit -m "feat: build parser-rules evidence ledger from saved analyses"
```

### Task 3: Add staged cluster, draft, critique, and eval helpers

**Files:**
- Modify: `src/lib/parser-rules/patch-workbench.ts`
- Possibly modify: `src/lib/openai.ts`
- Test: `scripts/parser-rules-patch-workbench.test.ts`

**Step 1: Write the failing test**

Extend the regression to assert the workbench module defines stage helpers for:

- `clusterIssues`
- `draftPatchCandidates`
- `critiquePatchCandidates`
- `evaluatePatchCandidates`
- `buildFinalAdjustmentBundle`

Also assert the helper references all intermediate artifact filenames.

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the stage helpers and artifact writes are missing.

**Step 3: Write minimal implementation**

In `src/lib/parser-rules/patch-workbench.ts`:

- add typed stage outputs for clusters, candidates, review, eval, and final bundle
- implement stage helper functions with the current LLM integration
- make each stage save its artifact JSON
- keep prompts stage-specific:
  - cluster prompt for grouping evidence
  - draft prompt for candidate insertions
  - critique prompt for duplicates and overfitting
  - eval prompt for coverage gain, risk, and confidence

If useful, add a small shared parser-rules LLM wrapper instead of duplicating fetch logic.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts src/lib/parser-rules/patch-workbench.ts src/lib/openai.ts
git commit -m "feat: add staged parser-rules patch workbench pipeline"
```

### Task 4: Add deterministic guardrails and eval-set selection

**Files:**
- Modify: `src/lib/parser-rules/patch-workbench.ts`
- Test: `scripts/parser-rules-patch-workbench.test.ts`

**Step 1: Write the failing test**

Extend the regression to assert the workbench module includes deterministic filters for:

- duplicate existing-rule detection
- weak evidence support
- fragile or missing anchors
- overly specific or branded wording
- representative eval-set selection stratified by layout, units, and issue coverage

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the workbench does not yet enforce these rules.

**Step 3: Write minimal implementation**

In `src/lib/parser-rules/patch-workbench.ts`:

- add prompt-text scanning to detect obvious duplicate rules
- add support thresholds such as minimum supporting files or evidence count
- add anchor validation against the active prompt text
- add an eval-set selector that samples a small but representative subset from the ledger
- ensure rejected candidates are written into `patch-review.json` with explicit reasons

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts src/lib/parser-rules/patch-workbench.ts
git commit -m "feat: add parser-rules patch guardrails and eval selection"
```

### Task 5: Expose the workbench through a streaming API route and resumable read route

**Files:**
- Modify: `src/app/api/admin/parser-rules/patch-workbench/route.ts`
- Modify: `src/lib/ndjson-stream.ts`
- Test: `scripts/parser-rules-patch-workbench.test.ts`
- Test: `scripts/parser-rules-stream.test.ts`

**Step 1: Write the failing test**

Extend the regression to assert:

- `POST /api/admin/parser-rules/patch-workbench` streams NDJSON event names:
  - `stage_start`
  - `stage_progress`
  - `stage_complete`
  - `candidate_preview`
  - `eval_result`
  - `complete`
  - `error`
- `GET /api/admin/parser-rules/patch-workbench` returns the latest final bundle

Update the stream regression if needed to cover the new event path.

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the route is still a skeleton.

**Step 3: Write minimal implementation**

In `src/app/api/admin/parser-rules/patch-workbench/route.ts`:

- verify admin access
- load the active prompt from the database
- call the workbench helper stages in order
- emit progress events between stages
- return the final bundle on `complete`

In the same route:

- add a `GET` handler that reads the latest saved bundle and summaries from disk

Reuse `src/lib/ndjson-stream.ts` for single-close streaming behavior.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

Run: `node --test --experimental-transform-types scripts/parser-rules-stream.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts scripts/parser-rules-stream.test.ts src/app/api/admin/parser-rules/patch-workbench/route.ts src/lib/ndjson-stream.ts
git commit -m "feat: stream parser-rules patch workbench progress"
```

### Task 6: Replace the client’s one-shot patch call with the streaming workbench UX

**Files:**
- Modify: `src/app/admin/parser-rules/ParserRulesClient.tsx`
- Possibly modify: `src/app/admin/parser-rules/page.tsx`
- Test: `scripts/parser-rules-patch-workbench.test.ts`

**Step 1: Write the failing test**

Extend the regression to assert the client:

- posts to `/api/admin/parser-rules/patch-workbench`
- tracks stage progress in state
- renders a workbench progress panel
- renders sections for:
  - final adjustments
  - rejected or merged ideas
  - evidence and eval details

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the client still calls the legacy patch route and only renders a flat suggestions list.

**Step 3: Write minimal implementation**

In `src/app/admin/parser-rules/ParserRulesClient.tsx`:

- replace `fetchPatch` with a streaming `runPatchWorkbench`
- parse NDJSON events just like the analysis flow
- add state for stage progress, candidate previews, eval results, and final bundle
- rename the button to reflect the new workbench purpose
- render:
  - progress panel
  - final adjustments
  - rejected or merged items
  - evidence and eval details

Keep the existing save/apply workflow, but source the final user-approvable patches from the final bundle rather than the old flat suggestions array.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts src/app/admin/parser-rules/ParserRulesClient.tsx src/app/admin/parser-rules/page.tsx
git commit -m "feat: add parser-rules patch workbench ui"
```

### Task 7: Retire or downgrade the legacy patch route safely

**Files:**
- Modify: `src/app/api/admin/parser-rules/patch/route.ts`
- Test: `scripts/parser-rules-patch-workbench.test.ts`

**Step 1: Write the failing test**

Extend the regression to assert the legacy route either:

- delegates to the new workbench contract, or
- returns a clear compatibility/deprecation response

The test should ensure the repo no longer depends on the legacy one-shot route for primary patch generation.

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: FAIL because the old route still owns the original one-shot behavior.

**Step 3: Write minimal implementation**

Pick one of these two paths:

- preferred: keep the route temporarily but make it a wrapper that returns the latest final bundle or points the UI to the new flow
- fallback: return a structured deprecation error with guidance

Do not leave two divergent prompt-adjustment implementations in place.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/parser-rules-patch-workbench.test.ts src/app/api/admin/parser-rules/patch/route.ts
git commit -m "refactor: retire legacy parser-rules patch flow"
```

### Task 8: Run full verification

**Files:**
- No new files required unless fixes are needed

**Step 1: Run focused regressions**

Run: `node --test --experimental-transform-types scripts/parser-rules-patch-workbench.test.ts`
Expected: PASS

Run: `node --test --experimental-transform-types scripts/parser-rules-stream.test.ts`
Expected: PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Manual admin verification**

In a logged-in admin browser session:

- open `/admin/parser-rules`
- run analysis if needed so `scripts/parser-analysis/` is populated
- trigger the new patch workbench
- confirm live progress appears for each stage
- confirm the final adjustments section includes evidence and eval metadata
- confirm rejected or merged ideas are visible
- save the approved prompt adjustments

**Step 5: Final commit**

```bash
git add docs/plans/2026-04-04-parser-rules-patch-workbench-design.md docs/plans/2026-04-04-parser-rules-patch-workbench.md src/app/api/admin/parser-rules/patch-workbench/route.ts src/app/api/admin/parser-rules/patch/route.ts src/app/admin/parser-rules/ParserRulesClient.tsx src/lib/parser-rules/patch-workbench.ts src/lib/ndjson-stream.ts scripts/parser-rules-patch-workbench.test.ts scripts/parser-rules-stream.test.ts
git commit -m "feat: add parser-rules patch workbench"
```
