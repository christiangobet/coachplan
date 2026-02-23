---
wave: 3
depends_on: [02-parser-PLAN]
files_modified:
  - src/app/api/plans/[id]/reparse/route.ts (new)
autonomous: true
---

# Plan 03 — Re-parse API Endpoint

## Goal
`POST /api/plans/[id]/reparse` — re-run the week-level schedule parsing against the original stored PDF text, using the current `planGuide` (which may have been edited by the user since upload). Updates `sessionInstructions`, `paceTarget`, `effortTarget`, `rawText`, and `title` on existing activities. Never touches `completed`, `actualDistance`, `actualDuration`, `actualPace`.

## Context

### Why re-parse is needed
After upload, the user reviews the guide and corrects it (wrong abbreviations, missing pace zones). Re-parse uses the corrected guide to re-run Pass 2 (schedule parsing) — improving activity data without re-uploading.

### What re-parse does NOT do
- Does not re-run Pass 1 (guide extraction) — user edits to `planGuide` must be preserved
- Does not change week/day structure (no new days or weeks created)
- Does not delete activities — updates existing ones in-place
- Does not overwrite athlete completion data (`completed`, `actualDistance`, `actualDuration`, `actualPace`, `completedAt`)

### Source of truth for re-parse text
The `PlanSourceDocument` table stores the original PDF bytes (`content Bytes`). Extract text from it using the same PDF-to-text logic already used in the upload route (pdfjs-dist is already in use — find the `extractTextFromPdf` or equivalent helper and reuse it, or extract the logic into a shared utility if needed).

### Plan's week/day structure
Re-parsing iterates over existing `PlanWeek` and `PlanDay` records. For each day, it re-runs `parseWeekWithAI` using the day's `rawText` (the original terse text) as input, plus the current `planGuide` as context.

Actually — the existing `parseWeekWithAI` parses a full week at once (7 day cells as a `Record<string, string>`). For re-parse, build the same `days` input object from the existing `PlanDay.rawText` values for that week, then call `parseWeekWithAI` with the current `planGuide`.

## Tasks

<task id="03.1" name="Create route file src/app/api/plans/[id]/reparse/route.ts">
Create the file. Export a `POST` handler.

Auth: use `auth()` from `@clerk/nextjs/server`. Verify the plan belongs to the authenticated user before proceeding.

Load: fetch the plan with its weeks, days, activities, and `planGuide` from Prisma. Also fetch `PlanSourceDocument` for the plan.

Return 404 if plan not found, 403 if not owned by the requesting user, 400 if no `PlanSourceDocument` exists (can't re-parse without source PDF).
</task>

<task id="03.2" name="Extract PDF text from stored PlanSourceDocument">
Reuse or extract the PDF text extraction logic from `src/app/api/plans/route.ts` (it uses `pdfjs-dist`).

If the extraction logic is embedded deeply in the upload handler, extract it into a shared helper `extractTextFromPdfBuffer(buffer: Buffer): Promise<string>` in `src/lib/pdf-utils.ts` (new file) and update the upload route to use it.

For re-parse: extract text from `planSourceDocument.content` (the stored PDF bytes as `Buffer`).
</task>

<task id="03.3" name="Re-run parseWeekWithAI per week with current planGuide">
For each `PlanWeek` in the plan (sorted by `weekIndex`):

1. Build the `days` input object: `Record<string, string>` mapping day name (`"monday"` etc.) to the `PlanDay.rawText` for that day (or empty string if no rawText).
2. Call `parseWeekWithAI({ planName: plan.name, weekNumber: week.weekIndex, days, planGuide: plan.planGuide ?? undefined })`.
3. Collect the parsed activities per day.

Handle failures per-week gracefully: if one week's parse fails, log and skip it, continue with remaining weeks. Return a summary of which weeks succeeded/failed.
</task>

<task id="03.4" name="Merge parsed results into existing activities">
For each day, match the parsed activities to existing `PlanActivity` records by position (index order — first parsed activity matches first existing activity of that day, etc.).

For each matched pair, update the existing activity with:
```typescript
{
  title: parsed.title (if non-empty),
  rawText: parsed.raw_text (if non-empty),
  sessionInstructions: parsed.instruction_text || null,
  paceTarget: resolved from parsed metrics/target_intensity,
  effortTarget: resolved from parsed metrics/target_intensity,
}
```

**Never update:** `completed`, `completedAt`, `actualDistance`, `actualDuration`, `actualPace`, `type` (don't change activity type on re-parse — too risky), `distance`, `duration` (don't change planned volume — athlete may have personalized these).

Use `prisma.planActivity.update` for each matched activity. Batch with `Promise.all` per day.

Unmatched parsed activities (more parsed than existing): skip — don't create new activities on re-parse.
Unmatched existing activities (more existing than parsed): leave untouched.
</task>

<task id="03.5" name="Return re-parse summary">
Return JSON response:
```json
{
  "weeksProcessed": 12,
  "weeksFailed": 0,
  "activitiesUpdated": 47,
  "planId": "..."
}
```
HTTP 200 on success. HTTP 207 (multi-status) if some weeks failed with a `weekErrors` array in the response.
</task>

## Verification

- [ ] `POST /api/plans/[id]/reparse` returns 401 if unauthenticated
- [ ] Returns 403 if plan belongs to different user
- [ ] Returns 400 if no `PlanSourceDocument` exists
- [ ] On success: `sessionInstructions` updated on activities
- [ ] Completed activities: `completed`, `actualDistance`, `actualPace` are unchanged after re-parse
- [ ] Response includes `weeksProcessed` and `activitiesUpdated` counts
- [ ] TypeScript compiles without errors

## must_haves
- Never overwrite `completed`, `actualDistance`, `actualDuration`, `actualPace` on any activity
- Never overwrite `distance`, `duration` (planned volume) — athlete may have personalized
- Never create new activities or weeks/days during re-parse
- Single week failure must not abort the entire re-parse
