# Markdown-Native Plan Parser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the large chunked `EXTRACTED_MD -> ProgramJsonV1` AI parse with a markdown-native deterministic parser plus a small per-session AI enrichment pass.

**Architecture:** Add a deterministic markdown parser that converts weekly markdown tables into a `ProgramJsonV1` skeleton, then enrich only ambiguous session rows with a narrow AI call. Keep the current completeness gate and `ProgramJsonV1 -> DB` persistence path so partial plans remain blocked from persistence.

**Tech Stack:** Next.js App Router, TypeScript, Node test scripts, existing OpenAI integration, existing `ProgramJsonV1` schema, existing `populatePlanFromV4(...)` persistence path.

---

### Task 1: Lock the deterministic parser contract with a failing test

**Files:**
- Create: `scripts/markdown-program-parser.test.ts`
- Create: `src/lib/parsing/markdown-program-parser.ts`

**Step 1: Write the failing test**

Create a source-level regression that asserts:

- a dedicated `markdown-program-parser` module exists
- it exports a parser function for `EXTRACTED_MD`
- it references deterministic week/table parsing rather than chunked whole-plan AI parsing
- it produces or validates a `ProgramJsonV1`-shaped output

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: FAIL because the parser module does not exist yet.

**Step 3: Write minimal implementation**

Create `src/lib/parsing/markdown-program-parser.ts` with:

- an exported `parseMarkdownProgram(...)` function
- minimal typed stubs for week section parsing
- a placeholder return shape aimed at `ProgramJsonV1`

Do not add real parsing logic yet.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/markdown-program-parser.test.ts src/lib/parsing/markdown-program-parser.ts
git commit -m "test: scaffold markdown-native parser contract"
```

### Task 2: Parse week sections and markdown tables deterministically

**Files:**
- Modify: `src/lib/parsing/markdown-program-parser.ts`
- Test: `scripts/markdown-program-parser.test.ts`

**Step 1: Write the failing test**

Extend the test with a realistic markdown fixture containing:

- `## Week 1`
- a weekly markdown table
- a `TWM` summary

Assert the parser returns:

- `program.plan_length_weeks`
- one parsed week
- the correct `week_number`
- parsed day rows mapped into `Mon..Sun`
- session `raw_text` values preserved

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: FAIL because the parser still contains only stubs.

**Step 3: Write minimal implementation**

Implement deterministic helpers for:

- splitting by `## Week N`
- identifying the weekly markdown table
- reading header and body rows
- mapping full day labels to schema day codes
- preserving row-level raw text
- parsing TWM into week summary metadata

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/markdown-program-parser.test.ts src/lib/parsing/markdown-program-parser.ts
git commit -m "feat: parse weekly markdown tables into program structure"
```

### Task 3: Add deterministic semantic extraction for core session fields

**Files:**
- Modify: `src/lib/parsing/markdown-program-parser.ts`
- Possibly modify: `src/lib/parsing/distance-parser.ts`
- Test: `scripts/markdown-program-parser.test.ts`

**Step 1: Write the failing test**

Extend the fixture coverage to assert deterministic extraction of:

- `activity_type`
- `distance_miles` or `distance_km`
- duration ranges
- `priority` and `priority_level`
- bail flags and must-do markers
- obvious session families like tempo, intervals, hills, long run, easy run, race

Use example session rows such as:

- `Easy run`
- `Long Run 10 miles`
- `WU 1 mile + Tempo 3 miles + CD 1 mile`
- `♥ Easy run`
- `⭐ Key session`

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: FAIL because semantic extraction is still incomplete.

**Step 3: Write minimal implementation**

In `markdown-program-parser.ts`:

- add rule-based activity type mapping
- detect stars and bail symbols
- infer obvious `session_role`
- extract numeric distance and duration fields
- preserve text that cannot yet be broken into steps

Reuse `distance-parser.ts` only if it helps; do not widen scope.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/markdown-program-parser.test.ts src/lib/parsing/markdown-program-parser.ts src/lib/parsing/distance-parser.ts
git commit -m "feat: add deterministic semantic extraction for markdown sessions"
```

### Task 4: Add a narrow AI enrichment module for ambiguous sessions

**Files:**
- Create: `src/lib/parsing/markdown-session-enricher.ts`
- Modify: `src/lib/openai.ts`
- Test: `scripts/markdown-program-parser.test.ts`

**Step 1: Write the failing test**

Add a source-level regression asserting:

- a `markdown-session-enricher` module exists
- it accepts a single session plus local context
- it is scoped to enriching fields like:
  - `steps`
  - `session_role`
  - `target_intensity`
  - `coaching_note`
  - `session_focus`
- it is not designed to parse whole weeks or a whole plan

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: FAIL because the enrichment module does not exist yet.

**Step 3: Write minimal implementation**

Create `src/lib/parsing/markdown-session-enricher.ts` with:

- a small typed enrichment input
- a small typed enrichment output
- an LLM prompt limited to one session row plus compact context
- explicit rules preventing structural reinterpretation of the whole program

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/markdown-program-parser.test.ts src/lib/parsing/markdown-session-enricher.ts src/lib/openai.ts
git commit -m "feat: add session-level markdown enrichment helper"
```

### Task 5: Replace the chunked markdown parse in `ai-plan-parser`

**Files:**
- Modify: `src/lib/ai-plan-parser.ts`
- Test: `scripts/markdown-program-parser.test.ts`
- Test: `scripts/markdown-first-budget.test.ts`

**Step 1: Write the failing test**

Add a regression that asserts the markdown-first path no longer depends on chunked whole-plan markdown parsing for the primary path when `EXTRACTED_MD` exists.

Assert:

- `parseExtractedMarkdownToProgram(...)` calls the deterministic markdown parser
- session-level enrichment is optional and narrow
- the old chunk scheduling path is no longer the primary route for complete markdown tables

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts scripts/markdown-first-budget.test.ts`
Expected: FAIL because `ai-plan-parser.ts` still uses the chunked markdown AI flow.

**Step 3: Write minimal implementation**

In `src/lib/ai-plan-parser.ts`:

- wire `EXTRACTED_MD` into `parseMarkdownProgram(...)`
- run session enrichment only for sessions needing refinement
- validate the resulting `ProgramJsonV1`
- keep completeness warnings intact
- keep artifacts and parse-job semantics aligned with the new path

Do not remove old code until the new path is passing; gate the replacement cleanly.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/markdown-program-parser.test.ts scripts/markdown-first-budget.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/markdown-program-parser.test.ts scripts/markdown-first-budget.test.ts src/lib/ai-plan-parser.ts
git commit -m "feat: route markdown-first parsing through deterministic parser"
```

### Task 6: Verify persistence and completeness still reject partial plans

**Files:**
- Modify: `src/lib/parsing/v4-to-plan.ts`
- Test: `scripts/program-week-completeness.test.ts`
- Test: `scripts/markdown-upload-enforcement.test.ts`

**Step 1: Write the failing test**

Extend the existing completeness regressions to assert the markdown-native parser path still:

- rejects missing leading weeks
- rejects non-contiguous week coverage
- refuses markdown-primary persistence for partial plans
- accepts complete contiguous plans

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/program-week-completeness.test.ts scripts/markdown-upload-enforcement.test.ts`
Expected: FAIL if the new path bypasses or weakens the current guardrails.

**Step 3: Write minimal implementation**

Ensure `populatePlanFromV4(...)` and the new markdown-native path both honor the same completeness rules.

Only touch `v4-to-plan.ts` if the new path requires tighter integration. Prefer reusing the current guard as-is.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/program-week-completeness.test.ts scripts/markdown-upload-enforcement.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/program-week-completeness.test.ts scripts/markdown-upload-enforcement.test.ts src/lib/parsing/v4-to-plan.ts
git commit -m "test: preserve completeness enforcement for markdown-native parser"
```

### Task 7: Run end-to-end verification on upload and review surfaces

**Files:**
- Test: `scripts/upload-page-async-ui.test.ts`
- Test: `scripts/plan-parse-context.test.ts`
- Test: `scripts/review-guide-ui.test.ts`
- Possibly modify: `src/lib/plan-parse-context.ts`

**Step 1: Write the failing test**

Add or extend regressions to assert:

- upload can progress from `EXTRACTED_MD` to parsed plan without the old chunk-budget bottleneck
- review still shows extracted markdown and parse status
- parsing-in-progress behavior remains correct during async processing

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-transform-types scripts/upload-page-async-ui.test.ts scripts/plan-parse-context.test.ts scripts/review-guide-ui.test.ts`
Expected: FAIL if the new parser path breaks status reporting or review assumptions.

**Step 3: Write minimal implementation**

Update parse-context or upload status plumbing only where the new markdown-native parser changes reported lifecycle fields.

Keep UI changes minimal.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-transform-types scripts/upload-page-async-ui.test.ts scripts/plan-parse-context.test.ts scripts/review-guide-ui.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/upload-page-async-ui.test.ts scripts/plan-parse-context.test.ts scripts/review-guide-ui.test.ts src/lib/plan-parse-context.ts
git commit -m "test: verify upload and review flows on markdown-native parser"
```

### Task 8: Run final verification and document any migration follow-ups

**Files:**
- Modify: `PROJECT_PLAN.md`

**Step 1: Write the failing test**

No new failing test. This is the verification and handoff step.

**Step 2: Run focused verification**

Run:

```bash
node --test --experimental-transform-types scripts/markdown-program-parser.test.ts scripts/markdown-first-budget.test.ts scripts/program-week-completeness.test.ts scripts/markdown-upload-enforcement.test.ts scripts/upload-page-async-ui.test.ts scripts/plan-parse-context.test.ts scripts/review-guide-ui.test.ts
npm run typecheck
```

Expected: PASS

**Step 3: Run broader verification if time permits**

Run:

```bash
npm run build
```

Expected: successful build, allowing for any already-known auth-route dynamic warnings.

**Step 4: Update project handoff note**

Replace the current timeout-focused parser handoff in `PROJECT_PLAN.md` with the new markdown-native parser status, remaining gaps, and any follow-up work such as:

- richer rule coverage for more session patterns
- further shrinking or caching enrichment calls
- migration cleanup for dead chunk-budget code

**Step 5: Commit**

```bash
git add PROJECT_PLAN.md
git commit -m "docs: update parser handoff after markdown-native migration"
```
