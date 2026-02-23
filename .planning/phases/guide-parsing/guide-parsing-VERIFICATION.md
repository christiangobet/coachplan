---
phase: guide-parsing
verified: 2026-02-23T10:15:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Upload a PDF plan and open the review page"
    expected: "planGuide textarea is populated with extracted guide content (PLAN OVERVIEW, GLOSSARY, PACE ZONES sections)"
    why_human: "Requires a live OpenAI API call during upload — cannot verify AI output programmatically"
  - test: "Edit the planGuide textarea, blur out of it, then click 'Re-parse Schedule with Current Guide'"
    expected: "Button is disabled while guideSaving=true; after re-parse, activity sessionInstructions are updated and a result banner shows 'Re-parsed: N weeks · M activities updated'"
    why_human: "Requires a real plan in DB with activities; end-to-end timing and UI state transitions cannot be verified statically"
  - test: "Open the Training Calendar on a day that has activities with sessionInstructions populated"
    expected: "'How to execute' collapsible appears beneath the activity name; it is collapsed by default; clicking it expands the instructions text"
    why_human: "Requires a plan with parsed sessionInstructions data; visual rendering needs human confirmation"
---

# Phase guide-parsing: Verification Report

**Phase Goal:** Surface session instructions to athletes and enable iterative guide-based parsing — extract a plan context guide on upload, use it to enrich parseWeekWithAI output, store sessionInstructions per activity, provide a re-parse endpoint, and show instructions to athletes in the day card.
**Verified:** 2026-02-23T10:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `planGuide String?` exists on `TrainingPlan` and `sessionInstructions String?` exists on `PlanActivity` in Prisma schema | VERIFIED | `prisma/schema.prisma` lines 140 and 235 respectively; migration `20260223095024_add_plan_guide_and_session_instructions` confirmed |
| 2 | `extractPlanGuide` is exported from `src/lib/ai-guide-extractor.ts` and never throws | VERIFIED | File exists, 187 lines of substantive implementation; top-level try/catch always returns `""` on failure (line 56–59) |
| 3 | `parseWeekWithAI` accepts optional `planGuide?` and injects it into the prompt | VERIFIED | `src/lib/ai-plan-parser.ts` line 161: `planGuide?: string`; line 192: `args.planGuide ? \`Plan context guide...\` : ""` |
| 4 | `buildActivityDrafts` stores `instruction_text` as `sessionInstructions`, NOT merged into `rawText` | VERIFIED | `src/app/api/plans/route.ts` lines 1191–1244: `sessionInstructions = instructionText \|\| null`; `rawText: displayRawText` (which is `decodedRawText`, the terse source) — the two fields are distinct |
| 5 | `POST /api/plans/[id]/reparse` exists, updates `sessionInstructions` / `paceTarget` / `effortTarget` / `rawText` / `title`, and never touches `completed` / `actualDistance` / `actualDuration` / `actualPace` / `distance` / `duration` | VERIFIED | File `src/app/api/plans/[id]/reparse/route.ts` is 233 lines; `updateData` type (lines 155–172) explicitly excludes all protected fields; grep confirms no assignment to any of the six protected fields |
| 6 | Review page has a guide panel with an editable textarea and a re-parse button | VERIFIED | `src/app/plans/[id]/review/page.tsx` lines 1974–2013: `<section className="review-page-card review-guide-panel">` with textarea, Saving/Saved indicator, and re-parse button with all required states |
| 7 | `DayLogCard` shows a collapsible "How to execute" `<details>` block only when `sessionInstructions` is non-null | VERIFIED | `src/components/DayLogCard.tsx` lines 553–558: `{activity.sessionInstructions && <details className="day-log-instructions">...</details>}` — guard prevents empty block |
| 8 | TypeScript compiles without errors | VERIFIED | `npx tsc --noEmit` exited with code 0, no output |

**Score:** 8/8 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | `planGuide String?` on TrainingPlan after `parseProfile` | VERIFIED | Line 140 |
| `prisma/schema.prisma` | `sessionInstructions String?` on PlanActivity after `notes` | VERIFIED | Line 235 |
| `prisma/migrations/*_add_plan_guide_and_session_instructions/` | Migration SQL file | VERIFIED | `20260223095024_add_plan_guide_and_session_instructions` directory present |
| `src/lib/ai-guide-extractor.ts` | Exports `extractPlanGuide(rawText): Promise<string>` | VERIFIED | 187-line file, substantive multi-provider implementation (OpenAI / Cloudflare / Gemini) |
| `src/lib/ai-plan-parser.ts` | `parseWeekWithAI` accepts `planGuide?: string` | VERIFIED | Line 161 in args type; line 192 injects into prompt |
| `src/app/api/plans/route.ts` | `buildActivityDrafts` sets `sessionInstructions` separately from `rawText` | VERIFIED | Lines 1191–1244 |
| `src/app/api/plans/route.ts` | Upload flow calls `extractPlanGuide` and saves to DB | VERIFIED | Lines 2117–2135; guarded by `ENABLE_AI_WEEK_PARSE`; failure is non-fatal |
| `src/app/api/plans/route.ts` | Upload flow passes `planGuide` to each `parseWeekWithAI` call | VERIFIED | Line 2228: `planGuide: planGuide \|\| undefined` |
| `src/app/api/plans/[id]/reparse/route.ts` | POST endpoint with auth, 401/403/404/400 guards, per-week parse loop, safe update | VERIFIED | 233-line substantive implementation; all four guard responses present |
| `src/app/plans/[id]/review/page.tsx` | Guide panel with textarea, auto-save, re-parse button, result display | VERIFIED | Lines 1974–2013; all five state variables present (lines 419–424) |
| `src/app/api/plans/[id]/route.ts` | PATCH handler accepts `planGuide` field | VERIFIED | Lines 119–121: `if ('planGuide' in body)` updates |
| `src/app/api/plans/[id]/review/activities/[activityId]/route.ts` | PATCH accepts `sessionInstructions` | VERIFIED | Lines 105, 130, 215–216 |
| `src/lib/log-activity.ts` | `LogActivity` type includes `sessionInstructions: string \| null`; `buildLogActivities` maps it | VERIFIED | Lines 26 and 98–100 |
| `src/components/DayLogCard.tsx` | Collapsible "How to execute" block, null-guarded | VERIFIED | Lines 553–558 |
| `src/app/dashboard/dashboard.css` | `.day-log-instructions` styles defined | VERIFIED | Lines 478–516 (approximate); 7 selectors confirmed by grep |
| `src/app/plans/[id]/review/review.css` | `.review-guide-panel` and sibling styles defined | VERIFIED | 6 selectors confirmed by grep starting at line 1219 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Upload route (`plans/route.ts`) | `ai-guide-extractor.ts` | `import { extractPlanGuide }` line 11; called line 2122 | WIRED | Call is inside `ENABLE_AI_WEEK_PARSE` guard; result saved to DB |
| Upload route | `parseWeekWithAI` | `planGuide: planGuide \|\| undefined` at line 2228 | WIRED | Guide threaded into every week's AI parse call |
| `buildActivityDrafts` | `sessionInstructions` in draft | `sessionInstructions` field set at line 1244, pushed into draft at line 1244 | WIRED | Written to DB in `planActivity.create` / `createMany` |
| Reparse route | `parseWeekWithAI` | Imported at line 4; called at lines 95–100 with `planGuide` | WIRED | Each week parsed independently; failures skip via `continue` |
| Reparse route | `prisma.planActivity.update` | `updateData` built per activity; `Promise.all` per day | WIRED | Only safe fields updated; protected fields absent from type |
| Review page | `PATCH /api/plans/[id]` | `persistPlanGuide` callback at line 980 via debounced auto-save | WIRED | Saves `{ planGuide: value }` on textarea blur |
| Review page | `POST /api/plans/[id]/reparse` | `triggerReparse` callback at line 1008 | WIRED | Sets all required state before/after fetch |
| `DayLogCard` | `LogActivity.sessionInstructions` | Accessed as `activity.sessionInstructions` at line 553 | WIRED | Rendered inside `<details>` conditional |
| Dashboard page | `buildLogActivities` | `activities: true` include fetches all Prisma fields including `sessionInstructions`; passed at line 506 | WIRED | `activities: true` fetches full model; `buildLogActivities` maps `sessionInstructions` |
| Calendar page | `buildLogActivities` | Explicit `sessionInstructions: activity.sessionInstructions ?? null` at line 422; `buildLogActivities` called at line implied by `DayLogCard activities={...}` | WIRED | Field explicitly included in `DatedActivity` type (line 63) and mapped |

---

## Requirements Coverage

All 5 plan files declared their own must_haves, all verified:

| Plan | Must-have | Status |
|------|-----------|--------|
| 01-schema | Both fields nullable; `sessionInstructions` on PlanActivity not PlanDay; `planGuide` is `String?` not `Json?` | SATISFIED |
| 02-parser | `rawText` stays terse (not replaced); `sessionInstructions` stored separately; extraction failure never blocks upload; `planGuide` saved post-upload | SATISFIED |
| 03-reparse | Never overwrite `completed`, `actualDistance`, `actualDuration`, `actualPace`, `distance`, `duration`; no new activities/weeks; single week failure non-fatal | SATISFIED |
| 04-review-ui | Guide save uses existing auto-save debounce (no separate Save button); re-parse disabled while guide saving; `sessionInstructions` field separate from `notes` | SATISFIED |
| 05-athlete-view | `sessionInstructions` block collapsed by default; shown only when non-null/non-empty; applies to all activity types | SATISFIED |

---

## Anti-Patterns Found

None. Scan of key modified files (`ai-guide-extractor.ts`, `reparse/route.ts`, `DayLogCard.tsx`, `log-activity.ts`) found no TODO/FIXME, no empty implementations, no placeholder returns. The only `return null` hit in `DayLogCard.tsx` is a numeric helper returning a correctly typed `null`.

---

## Human Verification Required

### 1. Guide Extraction on Upload

**Test:** Upload a real multi-week training plan PDF, then open the review page.
**Expected:** The "Plan Context Guide" textarea is populated with structured sections (PLAN OVERVIEW, GLOSSARY, PACE ZONES, etc.) extracted from the PDF. The content is meaningful — not empty, not an error message.
**Why human:** Requires a live OpenAI API call; correctness of AI output cannot be verified statically.

### 2. Re-parse End-to-End

**Test:** On the review page, make a small edit to the planGuide textarea (e.g., add an abbreviation definition), wait for "Saved" indicator, then click "Re-parse Schedule with Current Guide".
**Expected:** Button shows "Re-parsing…" state; after 30-60s, a result banner appears: "Re-parsed: N weeks · M activities updated". The activity sessionInstructions fields in the day breakdown refresh with updated content.
**Why human:** Requires a real plan with weeks/activities in DB; involves a 30-60s async process and UI state transitions.

### 3. Athlete Day Card — How to Execute Block

**Test:** Open the Training Calendar or Dashboard on a day that has a plan activity with `sessionInstructions` populated. Click the day to open the day card.
**Expected:** Each activity with `sessionInstructions` shows a "How to execute" collapsed toggle below the activity name. It does not expand automatically. Clicking it reveals the full instruction text. Activities without `sessionInstructions` show no toggle.
**Why human:** Requires a plan with populated `sessionInstructions` in the database; visual rendering and interaction need human confirmation.

---

## Gaps Summary

No gaps. All 8 observable truths are fully verified at all three levels (exists, substantive, wired). TypeScript compiles clean. The three human verification items are UI/AI-output quality checks that require a running environment — they do not represent code deficiencies.

---

_Verified: 2026-02-23T10:15:00Z_
_Verifier: Claude (gsd-verifier)_
