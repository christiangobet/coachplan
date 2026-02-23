---
wave: 1
depends_on: []
files_modified:
  - prisma/schema.prisma
  - prisma/migrations/
autonomous: true
---

# Plan 01 — Schema: planGuide + sessionInstructions

## Goal
Add two new fields to the database that will hold the guide-driven parsing context. Everything else in this feature depends on this migration being in place.

## Context
- `TrainingPlan.planGuide` — free-form text blob storing the full extracted plan context document (structural overview, glossary, pace zones, named sessions, general instructions). Editable by user on review page.
- `PlanActivity.sessionInstructions` — per-activity execution instructions, expanded from guide context during parsing. Displayed to athlete on day card. Separate from `rawText` (which stays as terse source text).

`parseProfile` already exists as a JSON field on `TrainingPlan` — do not repurpose it; `planGuide` is a distinct concept (human-readable, editable text vs. machine parse metadata).

## Tasks

<task id="01.1" name="Add planGuide to TrainingPlan">
In `prisma/schema.prisma`, add to the `TrainingPlan` model:

```
planGuide String?
```

Place it after the `parseProfile Json?` field.
</task>

<task id="01.2" name="Add sessionInstructions to PlanActivity">
In `prisma/schema.prisma`, add to the `PlanActivity` model:

```
sessionInstructions String?
```

Place it after the existing `notes String?` field.
</task>

<task id="01.3" name="Run migration">
Run:
```bash
npx prisma migrate dev --name add_plan_guide_and_session_instructions
```

Verify the migration file is created under `prisma/migrations/`.
</task>

<task id="01.4" name="Regenerate Prisma client">
Run:
```bash
npx prisma generate
```

Confirm no TypeScript errors in files that import from `@prisma/client`.
</task>

## Verification

- [ ] `prisma/schema.prisma` contains `planGuide String?` on `TrainingPlan`
- [ ] `prisma/schema.prisma` contains `sessionInstructions String?` on `PlanActivity`
- [ ] Migration file exists in `prisma/migrations/`
- [ ] `npx prisma generate` completes without errors
- [ ] Existing data unaffected (both fields nullable, no default required)

## must_haves
- Both new fields are nullable (no breaking change to existing records)
- `sessionInstructions` is on `PlanActivity`, not `PlanDay`
- `planGuide` is `String?` not `Json?` — must remain human-readable plain text
