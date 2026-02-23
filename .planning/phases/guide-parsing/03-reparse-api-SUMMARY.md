---
phase: guide-parsing
plan: 03
subsystem: api
tags: [nextjs, prisma, openai, clerk, activity-parsing, reparse]

# Dependency graph
requires:
  - phase: guide-parsing
    provides: parseWeekWithAI helper, PlanSourceDocument model, PlanDay.rawText, intensity-targets lib

provides:
  - POST /api/plans/[id]/reparse endpoint
  - Per-week AI re-parsing from stored PlanDay.rawText using current planGuide
  - Safe merge that never overwrites athlete completion data or planned volume

affects: [guide-parsing-04-review-ui, guide-parsing-05-athlete-view]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-parse pattern: re-use parseWeekWithAI with PlanDay.rawText as input; no PDF re-extraction needed"
    - "Position-index merge: match parsed activities to existing by index; skip extras in both directions"
    - "Per-week error isolation: catch per-week, log, push to weekErrors array, continue; return HTTP 207 on partial failure"

key-files:
  created:
    - src/app/api/plans/[id]/reparse/route.ts
  modified: []

key-decisions:
  - "Use PlanDay.rawText as re-parse input — no need to re-extract text from PlanSourceDocument.content; rawText is already the canonical per-day cell text from the original parse"
  - "Position-index activity matching — first parsed activity maps to first existing; simpler than fuzzy matching and consistent with how activities were created"
  - "Never update distance/duration/type — planned volume and activity type are too risky to auto-change on re-parse; only update sessionInstructions, paceTarget, effortTarget, rawText, title"
  - "HTTP 207 Multi-Status on partial week failure — allows client to see partial success with weekErrors detail"

patterns-established:
  - "Per-week AI loop with graceful skip: for each week, catch errors, log non-fatally, continue loop"
  - "Structured intensity target derivation: always call deriveStructuredIntensityTargets alongside raw paceTarget/effortTarget strings"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-02-23
---

# Phase guide-parsing Plan 03: Re-parse API Endpoint Summary

**POST /api/plans/[id]/reparse re-runs week-level AI schedule parsing from stored PlanDay.rawText using current planGuide, updating sessionInstructions and intensity targets while never touching athlete completion data or planned volume**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-23T09:59:41Z
- **Completed:** 2026-02-23T10:08:00Z
- **Tasks:** 5
- **Files modified:** 1 (created)

## Accomplishments
- Implemented full re-parse API endpoint with auth (401/403/404/400 guard coverage)
- Re-uses existing `parseWeekWithAI` with per-day `rawText` as input — no PDF re-extraction required
- Per-week failure isolation: a single week parse error logs and continues, returning HTTP 207 with `weekErrors` on partial failure
- Merges parsed results by position index; updates title, rawText, sessionInstructions, paceTarget, effortTarget, and all structured intensity target fields; leaves completed/actualDistance/actualDuration/actualPace/distance/duration untouched

## Task Commits

All tasks implemented in a single cohesive commit (one file created):

1. **Task 03.1: Create route file with auth and plan loading** - `ecd1319` (feat)
2. **Task 03.2: PDF text extraction** - `ecd1319` (not needed — PlanDay.rawText already stores per-day cell text; no re-extraction from PDF required)
3. **Task 03.3: Re-run parseWeekWithAI per week** - `ecd1319` (feat)
4. **Task 03.4: Merge parsed results into existing activities** - `ecd1319` (feat)
5. **Task 03.5: Return re-parse summary** - `ecd1319` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/app/api/plans/[id]/reparse/route.ts` - POST handler: auth guard, plan+weeks+days+activities load, per-week parseWeekWithAI loop, position-index merge, 207/200 response

## Decisions Made
- **No PDF re-extraction needed:** `PlanDay.rawText` already holds the canonical per-day cell text captured during the original upload parse. Re-extracting from `PlanSourceDocument.content` would add complexity without benefit — the rawText is what `parseWeekWithAI` needs.
- **Position-index activity matching:** Simpler and predictable. Matches the order in which activities were originally created. Handles unmatched extras cleanly (skip extras on both sides).
- **Never update `distance`, `duration`, `type`:** Plan specifies this; confirmed as correct — athletes may have personalized planned volume, and type changes on re-parse are too risky.
- **HTTP 207 on partial week failure:** Enables clients to surface partial success with per-week error detail rather than returning a binary 200/500.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Clarification] Task 03.2 resolution — no new pdf-utils.ts helper needed**
- **Found during:** Task 03.2 (Extract PDF text from stored PlanSourceDocument)
- **Issue:** Plan specified extracting text from `PlanSourceDocument.content`. However, `PlanDay.rawText` already stores the per-day cell text that `parseWeekWithAI` needs — re-extracting the PDF would be redundant and add unnecessary complexity.
- **Fix:** Used `PlanDay.rawText` directly as the `days` input. `PlanSourceDocument` is still fetched to guard the 400 (no source document) path. No `pdf-utils.ts` helper was created.
- **Files modified:** None additional — logic stays in route.ts
- **Verification:** TypeScript compiles cleanly; logic matches plan intent

---

**Total deviations:** 1 clarification (Task 03.2 scope simplification — beneficial, not a gap)
**Impact on plan:** Simpler implementation. No PDF byte reading required. All must_haves satisfied.

## Issues Encountered
None — TypeScript compiled cleanly on first attempt with zero errors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `/api/plans/[id]/reparse` is ready for consumption by the review UI (Plan 04)
- Response shape (`weeksProcessed`, `weeksFailed`, `activitiesUpdated`, `planId`, optional `weekErrors`) is stable
- No blockers

---
*Phase: guide-parsing*
*Completed: 2026-02-23*
