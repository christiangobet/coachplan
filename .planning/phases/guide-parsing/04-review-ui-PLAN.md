---
wave: 4
depends_on: [03-reparse-api-PLAN]
files_modified:
  - src/app/plans/[id]/review/page.tsx
  - src/app/api/plans/[id]/route.ts (PATCH planGuide)
  - src/app/plans/plans.css (or review-specific CSS)
autonomous: true
---

# Plan 04 — Review Page: Guide Editor + Re-parse Button + Session Instructions

## Goal
Surface the plan guide and session instructions in the review page so the user can (1) read and correct the extracted guide, (2) trigger a re-parse using the corrected guide, and (3) see per-activity `sessionInstructions` alongside the existing activity fields.

## Context

### Review page structure (existing)
- `src/app/plans/[id]/review/page.tsx` — large client component (~1900+ lines)
- Auto-save pattern already in place (`autosaveState`)
- Per-day breakdown with activity rows and editable fields

### New sections to add
1. **Guide Panel** — above the weekly breakdown, shows `planGuide` in an editable textarea. Auto-saves on blur using `PATCH /api/plans/[id]` with `{ planGuide }`.
2. **Re-parse Button** — inside/below the guide panel. Calls `POST /api/plans/[id]/reparse`. Shows progress and result summary.
3. **Session Instructions** — per activity in the existing day breakdown. Shows `sessionInstructions` as a read-only (but editable) text block below the activity metrics fields.

### API for saving planGuide
`PATCH /api/plans/[id]` already exists (`src/app/api/plans/[id]/route.ts`). Check if it accepts `planGuide` in the body — if not, add it to the allowed patch fields.

### State needed
- `planGuide: string` — current value of guide textarea
- `guideSaving: boolean` — auto-save in progress
- `guideSaved: boolean` — brief "Saved" flash after save
- `reparsing: boolean` — re-parse in progress
- `reparseResult: { weeksProcessed, activitiesUpdated } | null`
- `reparseError: string | null`

## Tasks

<task id="04.1" name="Load planGuide from plan data">
In the review page, the plan object is already fetched. Ensure `planGuide` is included in the API response from `GET /api/plans/[id]`.

Check `src/app/api/plans/[id]/route.ts` GET handler — add `planGuide` to the select/include if not already present.

Initialize `planGuide` state from `plan.planGuide ?? ''`.
</task>

<task id="04.2" name="Add PATCH support for planGuide in plans/[id]/route.ts">
In `src/app/api/plans/[id]/route.ts` PATCH handler, add `planGuide` to the allowed update fields:

```typescript
if (typeof body.planGuide === 'string') {
  updateData.planGuide = body.planGuide;
}
```
</task>

<task id="04.3" name="Add Guide Panel to review page">
Add a new section between the hero stats grid and the weekly breakdown:

```
┌─────────────────────────────────────────────────┐
│ PLAN CONTEXT GUIDE                    [Saved ✓] │
│ ─────────────────────────────────────────────── │
│ [textarea — full planGuide content]             │
│                                                 │
│ This guide is used to expand abbreviations and  │
│ write session instructions during parsing.      │
│ Correct any errors, then re-parse.              │
│                                                 │
│ [Re-parse Schedule ↺]  [result: 47 updated]    │
└─────────────────────────────────────────────────┘
```

The textarea auto-saves on blur (debounced 800ms) via `PATCH /api/plans/[id]` with `{ planGuide }`. Show a small "Saving…" / "Saved" indicator.

If `planGuide` is empty (plan predates this feature or extraction produced nothing), show a placeholder: "No guide extracted yet. Add abbreviations and pace zone definitions here to improve parsing."

CSS class: `review-guide-panel`. Add styles to the plans CSS file (same file used by review page — check the existing `@import` or CSS file reference in the review page).
</task>

<task id="04.4" name="Add Re-parse button and handler">
Inside the guide panel, add a "Re-parse Schedule" button.

On click:
1. Set `reparsing = true`, clear `reparseResult`, clear `reparseError`
2. `POST /api/plans/[id]/reparse`
3. On success: set `reparseResult = { weeksProcessed, activitiesUpdated }`, call `router.refresh()` to reload activity data
4. On error: set `reparseError = body.error || 'Re-parse failed'`
5. Set `reparsing = false`

Button states:
- Default: "↺ Re-parse Schedule with Current Guide"
- Loading: "Re-parsing… (this may take 30–60s)"
- Disabled while `reparsing || autosaveState.busy`

Result display (shown after successful re-parse, fades after 10s):
- "✓ Re-parsed: {weeksProcessed} weeks · {activitiesUpdated} activities updated"

Error display: red inline message below the button.

Add a subtle warning note: "Re-parse updates activity titles, instructions, and pace targets. It does not change logged data or planned distances."
</task>

<task id="04.5" name="Show sessionInstructions per activity in day breakdown">
In the existing per-activity section of the day breakdown (inside the `days.map → activities.map` loop), add a `sessionInstructions` field after the existing activity metrics fields.

Display as an editable textarea:
- Label: "Session Instructions"
- Value: `activityDraft.sessionInstructions ?? ''`
- On change: update local draft state (same pattern as other editable fields)
- Auto-saves via the existing activity autosave mechanism (`PATCH /api/plans/[id]/review/activities/[activityId]`)

Check `src/app/api/plans/[id]/review/activities/[activityId]/route.ts` — add `sessionInstructions` to the allowed update fields if not already present.

Show the field collapsed by default (same `notesOpen` toggle pattern as the existing "Show Notes" button). Label the toggle: "Session Instructions" (separate from "Notes").
</task>

## Verification

- [ ] Guide panel renders above weekly breakdown
- [ ] `planGuide` textarea shows extracted guide content
- [ ] Editing and blurring textarea saves to DB (verify via Prisma Studio or network tab — PATCH request fires)
- [ ] "Re-parse Schedule" button fires `POST /api/plans/[id]/reparse`
- [ ] After re-parse, activity `sessionInstructions` fields refresh with new values
- [ ] Per-activity "Session Instructions" textarea is editable and saves
- [ ] No TypeScript errors

## must_haves
- Guide save must use the existing auto-save debounce pattern — do not add a separate "Save" button
- Re-parse button must be disabled while guide is saving (`autosaveState.busy`) — guide must be saved before re-parsing
- `sessionInstructions` field in activity rows must be separate from the existing `notes` field
- Re-parse result summary must be visible to the user after completion
