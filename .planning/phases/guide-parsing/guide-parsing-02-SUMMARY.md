---
phase: guide-parsing
plan: "02"
subsystem: api
tags: [openai, prisma, pdf-parsing, typescript]

# Dependency graph
requires:
  - phase: guide-parsing-01
    provides: planGuide field on TrainingPlan, sessionInstructions field on PlanActivity (schema migration)
provides:
  - src/lib/ai-guide-extractor.ts with extractPlanGuide function
  - Two-pass PDF parsing: guide extraction (Pass 1) then context-aware week parsing (Pass 2)
  - sessionInstructions stored separately from rawText on PlanActivity
  - planGuide saved to TrainingPlan record on upload
affects: [guide-parsing-03, guide-parsing-04, guide-parsing-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Provider-aware AI text completion (OpenAI/Cloudflare/Gemini) without JSON schema, mirroring openai.ts pattern
    - Two-pass parsing: guide extraction feeds context into per-week AI parsing
    - Graceful degradation: any failure in guide extraction returns empty string and never blocks upload

key-files:
  created:
    - src/lib/ai-guide-extractor.ts
  modified:
    - src/lib/ai-plan-parser.ts
    - src/app/api/plans/route.ts

key-decisions:
  - "extractPlanGuide uses provider-aware plain-text completion (not JSON schema) with 2000 token cap"
  - "Guide extraction only runs when ENABLE_AI_WEEK_PARSE is active to avoid extra API cost when AI is disabled"
  - "rawText on PlanActivity is now the terse decodedRawText only; instruction_text goes to sessionInstructions"
  - "extractPdfText(buffer) reused for guide extraction to avoid a second pdfjs parse"

patterns-established:
  - "Pass 1 / Pass 2 two-pass AI parsing pattern for PDF upload"
  - "Graceful degradation on AI sub-calls: empty string fallback, never throw to caller"

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase guide-parsing Plan 02: Two-Pass Parser Summary

**Provider-aware extractPlanGuide (Pass 1) feeds structured plan context into parseWeekWithAI (Pass 2), storing expanded instruction_text as sessionInstructions separate from terse rawText**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T09:53:39Z
- **Completed:** 2026-02-23T09:57:45Z
- **Tasks:** 4 (02.1-02.4; 02.5 is manual verification)
- **Files modified:** 3 modified, 1 created

## Accomplishments
- Created `src/lib/ai-guide-extractor.ts` with `extractPlanGuide(rawText)`: plain-text AI call (not JSON schema) that extracts PLAN OVERVIEW, GLOSSARY, PACE ZONES, NAMED SESSIONS, and GENERAL INSTRUCTIONS from the full PDF text
- Added `planGuide?: string` parameter to `parseWeekWithAI` in `ai-plan-parser.ts`; guide injected into prompt after the legend line with updated system instruction
- Split `buildAiActivities` in `route.ts`: `rawText` now stores terse `decodedRawText` only; `instruction_text` from AI stored as `sessionInstructions` on each activity draft
- Wired full two-pass flow in the upload handler: `extractPdfText(buffer)` + `extractPlanGuide` before the per-week loop, result saved to `TrainingPlan.planGuide` and passed to each `parseWeekWithAI` call

## Task Commits

Each task was committed atomically:

1. **Task 02.1: Create ai-guide-extractor.ts** - `25dcec7` (feat)
2. **Task 02.2: Add planGuide to parseWeekWithAI** - `7ee3268` (feat)
3. **Task 02.3: Store sessionInstructions separately** - `e8661a1` (feat)
4. **Task 02.4: Wire guide extraction into upload flow** - `e7ae856` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `src/lib/ai-guide-extractor.ts` - New: exports `extractPlanGuide(rawText): Promise<string>`; provider-aware (OpenAI/Cloudflare/Gemini); never throws
- `src/lib/ai-plan-parser.ts` - Added `planGuide?: string` to `parseWeekWithAI` args; guide injected into prompt; system instruction updated to reference guide
- `src/app/api/plans/route.ts` - Added `ActivityDraft.sessionInstructions?: string | null`; `buildAiActivities` now stores `instruction_text` as `sessionInstructions` and keeps `rawText` as terse source; import of `extractPlanGuide` and `extractPdfText`; Pass 1 guide extraction block wired before per-week loop

## Decisions Made
- Used `extractPdfText(buffer)` (already in codebase from V4 parser) rather than a separate pdfjs parse to get `fullText` for the guide extractor
- Guide extraction gated on `ENABLE_AI_WEEK_PARSE` to avoid unnecessary API calls when AI parsing is disabled
- Provider-aware text completion implemented directly in `ai-guide-extractor.ts` (no shared helper available in `openai.ts` for plain-text calls)
- `planGuide` update failure (Prisma) is caught and logged but never propagates — upload always succeeds

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. TypeScript compiled cleanly on all four tasks. Pre-existing lint errors in other files are out of scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `extractPlanGuide` and `parseWeekWithAI(planGuide)` are in place — ready for Plan 03 (reparse API) which can trigger re-extraction/re-parsing with the stored guide
- `sessionInstructions` field is now populated on new uploads; Plan 04 (review UI) can surface it to coaches
- `planGuide` stored on `TrainingPlan` is available for Plan 05 (athlete view) coaching context display

---
*Phase: guide-parsing*
*Completed: 2026-02-23*

## Self-Check: PASSED

- FOUND: `src/lib/ai-guide-extractor.ts`
- FOUND: `guide-parsing-02-SUMMARY.md`
- FOUND: commit `25dcec7` (task 02.1)
- FOUND: commit `7ee3268` (task 02.2)
- FOUND: commit `e8661a1` (task 02.3)
- FOUND: commit `e7ae856` (task 02.4)
