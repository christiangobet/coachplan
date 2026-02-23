---
phase: guide-parsing
plan: 05
subsystem: ui
tags: [react, nextjs, typescript, prisma, css, daylogcard]

# Dependency graph
requires:
  - phase: guide-parsing
    provides: sessionInstructions field on PlanActivity (added in earlier parsing plans)
provides:
  - sessionInstructions surfaced in DayLogCard as collapsible "How to execute" block
  - LogActivity type extended with sessionInstructions field
  - Calendar DatedActivity type extended with sessionInstructions field
affects: [calendar, dashboard, DayLogCard, log-activity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Native HTML details/summary for zero-state collapsible content"
    - "Null-safe sessionInstructions mapping in buildLogActivities"

key-files:
  created: []
  modified:
    - src/lib/log-activity.ts
    - src/app/calendar/page.tsx
    - src/components/DayLogCard.tsx
    - src/app/dashboard/dashboard.css

key-decisions:
  - "Used native <details>/<summary> HTML elements - no React state needed, collapsed by default"
  - "Added ::-webkit-details-marker reset alongside ::before arrow for cross-browser compatibility"
  - "Dashboard page already spreads raw Prisma activity so sessionInstructions flows through naturally; only calendar needed explicit DatedActivity type extension"
  - "Trim and null-check sessionInstructions in buildLogActivities to prevent empty block rendering"

patterns-established:
  - "sessionInstructions: trim + null coerce in buildLogActivities before passing to components"
  - "day-log-instructions CSS classes in dashboard.css (shared base for dashboard and calendar)"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-02-23
---

# Phase guide-parsing Plan 05: Athlete View Summary

**Collapsible "How to execute" session instructions block added to DayLogCard using native details/summary, threaded from Prisma through LogActivity type to both dashboard and calendar**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-23T10:09:30Z
- **Completed:** 2026-02-23T10:11:38Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments

- Extended `LogActivity` type with `sessionInstructions: string | null` and mapped it in `buildLogActivities` with trim/null-safe logic
- Added `sessionInstructions` to `DatedActivity` type and mapping in `calendar/page.tsx` (dashboard already spreads raw Prisma object)
- Rendered collapsible "How to execute" block in `DayLogCard` `ActivityRow` using native `<details>/<summary>` — no React state required, collapsed by default
- Added full CSS for `.day-log-instructions`, `.day-log-instructions-toggle`, and `.day-log-instructions-text` in shared `dashboard.css`

## Task Commits

Each task was committed atomically:

1. **Task 05.1: Add sessionInstructions to LogActivity type and buildLogActivities** - `6d42217` (feat)
2. **Task 05.2: Include sessionInstructions in Prisma queries** - `349c4a3` (feat)
3. **Task 05.3: Show sessionInstructions in DayLogCard ActivityRow** - `ed48e83` (feat)
4. **Task 05.4: Style the session instructions block** - `6997f05` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `/Users/christiangobet/CODEX/coachplan/src/lib/log-activity.ts` - Added `sessionInstructions: string | null` to `LogActivity` type; mapped in `buildLogActivities` with trim and null coercion
- `/Users/christiangobet/CODEX/coachplan/src/app/calendar/page.tsx` - Added `sessionInstructions` to `DatedActivity` type and the activity mapping loop
- `/Users/christiangobet/CODEX/coachplan/src/components/DayLogCard.tsx` - Added `<details className="day-log-instructions">` block in `ActivityRow` render, shown only when `sessionInstructions` is non-null/non-empty
- `/Users/christiangobet/CODEX/coachplan/src/app/dashboard/dashboard.css` - Added 43 lines of CSS for `.day-log-instructions*` classes including animated arrow indicator

## Decisions Made

- Used native `<details>/<summary>` HTML elements — no React state, collapsed by default, accessible out of the box
- Dashboard spreads raw Prisma activity (`...activity`) so `sessionInstructions` flows through without code changes; only calendar's explicit `DatedActivity` type mapping needed updating
- Added `::-webkit-details-marker { display: none }` alongside the `::before` arrow for consistent cross-browser rendering
- Placed CSS in `dashboard.css` (shared base imported by both dashboard and calendar pages) so styles apply everywhere `DayLogCard` is used

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Build compiles successfully (`✓ Compiled successfully`). All Clerk "Dynamic server usage" warnings in build output are pre-existing, auth-related, and unrelated to this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `sessionInstructions` is now fully surfaced to athletes on both dashboard and calendar
- The "How to execute" block is production-ready: collapsed by default, shows only when content exists, applies to all activity types
- No blockers for subsequent phases

---
*Phase: guide-parsing*
*Completed: 2026-02-23*

## Self-Check: PASSED

- FOUND: src/lib/log-activity.ts
- FOUND: src/app/calendar/page.tsx
- FOUND: src/components/DayLogCard.tsx
- FOUND: src/app/dashboard/dashboard.css
- FOUND: .planning/phases/guide-parsing/05-athlete-view-SUMMARY.md
- FOUND commit: 6d42217 (task 05.1)
- FOUND commit: 349c4a3 (task 05.2)
- FOUND commit: ed48e83 (task 05.3)
- FOUND commit: 6997f05 (task 05.4)
- Build: compiled successfully
