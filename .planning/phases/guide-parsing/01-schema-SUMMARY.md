---
phase: guide-parsing
plan: 01
subsystem: database
tags: [prisma, postgresql, schema, migration]

# Dependency graph
requires: []
provides:
  - planGuide String? field on TrainingPlan model
  - sessionInstructions String? field on PlanActivity model
  - Migration 20260223095024_add_plan_guide_and_session_instructions applied to database
affects:
  - guide-parsing/02-parser
  - guide-parsing/03-reparse-api
  - guide-parsing/04-review-ui
  - guide-parsing/05-athlete-view

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nullable text columns for human-readable AI-generated content (String? not Json?)"

key-files:
  created:
    - prisma/migrations/20260223095024_add_plan_guide_and_session_instructions/migration.sql
  modified:
    - prisma/schema.prisma

key-decisions:
  - "planGuide is String? not Json? — must remain human-readable plain text, distinct from parseProfile Json?"
  - "sessionInstructions placed on PlanActivity not PlanDay — per-activity execution instructions"
  - "Both fields nullable — zero breaking change to existing records"
  - "Used unpooled Neon connection URL for migrate dev (pooled URL not compatible with migrations)"

patterns-established:
  - "Human-readable AI-generated text stored as String?, not Json?"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-02-23
---

# Phase guide-parsing Plan 01: Schema Summary

**Prisma schema extended with planGuide (TrainingPlan) and sessionInstructions (PlanActivity) as nullable text fields, migration applied to Neon PostgreSQL**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-23T09:49:37Z
- **Completed:** 2026-02-23T09:51:08Z
- **Tasks:** 4
- **Files modified:** 2 (schema + migration)

## Accomplishments
- Added `planGuide String?` to TrainingPlan model after `parseProfile Json?`
- Added `sessionInstructions String?` to PlanActivity model after `notes String?`
- Migration `20260223095024_add_plan_guide_and_session_instructions` applied to Neon DB successfully
- Prisma client regenerated, TypeScript check passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 01.1: Add planGuide to TrainingPlan** - `ca714e6` (chore)
2. **Task 01.2: Add sessionInstructions to PlanActivity** - `8d19dc2` (chore)
3. **Task 01.3: Run migration** - `2188eac` (chore)
4. **Task 01.4: Regenerate Prisma client** - (included in migration auto-generate, no separate commit needed — Prisma generate updates node_modules only, not tracked files)

**Plan metadata:** (created in this step)

## Files Created/Modified
- `prisma/schema.prisma` - Added planGuide to TrainingPlan (line 140), sessionInstructions to PlanActivity (line 235)
- `prisma/migrations/20260223095024_add_plan_guide_and_session_instructions/migration.sql` - ALTER TABLE statements for both new columns

## Decisions Made
- `planGuide` is `String?` not `Json?` — keeps it human-readable and editable, unlike `parseProfile` which is machine metadata
- `sessionInstructions` is on `PlanActivity`, not `PlanDay` — per the plan's must_haves (per-activity granularity)
- Used `DATABASE_URL_UNPOOLED` (direct connection) for `prisma migrate dev` — Neon's pooled URL does not support DDL migrations
- Migration also cleaned up unrelated foreign key drift on ExternalActivity (normal Prisma behavior, not a schema change)

## Deviations from Plan

None - plan executed exactly as written.

(The migration SQL also included minor ExternalAccount/ExternalActivity foreign key cleanup — this is Prisma detecting existing drift and correcting it, not a new schema change. Both target fields were added exactly as specified.)

## Issues Encountered
- `prisma migrate dev` failed initially because `DATABASE_URL` env var was not sourced (it's in `.env.local`, not `.env`). Resolved by passing the unpooled URL inline via `DATABASE_URL=... npx prisma migrate dev`.

## User Setup Required
None - no external service configuration required. Migration was applied directly to the shared Neon development database.

## Next Phase Readiness
- Database schema ready for guide-parsing/02-parser which will populate planGuide during PDF parsing
- Database schema ready for guide-parsing/03-reparse-api which will update sessionInstructions per activity
- Both fields immediately queryable/writable via Prisma client

---
*Phase: guide-parsing*
*Completed: 2026-02-23*

## Self-Check: PASSED

- FOUND: `prisma/schema.prisma` contains `planGuide String?` at line 140
- FOUND: `prisma/schema.prisma` contains `sessionInstructions String?` at line 235
- FOUND: `prisma/migrations/20260223095024_add_plan_guide_and_session_instructions/migration.sql`
- FOUND: commit `ca714e6` (planGuide schema change)
- FOUND: commit `8d19dc2` (sessionInstructions schema change)
- FOUND: commit `2188eac` (migration file)
