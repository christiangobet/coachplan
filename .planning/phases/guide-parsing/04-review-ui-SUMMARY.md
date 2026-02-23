---
phase: guide-parsing
plan: "04"
subsystem: review-ui
tags: [review-page, guide-panel, reparse, session-instructions, ui]
dependency_graph:
  requires: [03-reparse-api]
  provides: [guide-panel-ui, reparse-button, session-instructions-display]
  affects: [plans/[id]/review]
tech_stack:
  added: []
  patterns: [autosave-on-blur, debounced-save, collapsible-panel, router-refresh]
key_files:
  created: []
  modified:
    - src/app/plans/[id]/review/page.tsx
    - src/app/plans/[id]/review/review.css
    - src/app/api/plans/[id]/route.ts
    - src/app/api/plans/[id]/review/activities/[activityId]/route.ts
decisions:
  - planGuide auto-saves on blur with 800ms debounce, no separate Save button
  - Re-parse button disabled while guideSaving or autosaveState.busy
  - sessionInstructions uses separate toggle button in activity action row
  - loadPlan() called after re-parse to refresh activity data without full page reload
metrics:
  duration: "~5 minutes"
  completed: "2026-02-23"
  tasks_completed: 5
  files_changed: 4
---

# Phase guide-parsing Plan 04: Review Page Guide Editor + Re-parse Button + Session Instructions Summary

## One-liner

Guide panel with planGuide textarea + re-parse button + per-activity sessionInstructions in the parsing review page.

## What Was Built

### Task 04.1 — Load planGuide from plan data
- Added `planGuide` field to `ReviewPlan` type
- `loadPlan()` now sets `planGuide` state from `plan.planGuide ?? ''`
- `GET /api/plans/[id]` already returns `planGuide` as a scalar field on `TrainingPlan` (no query change needed)

### Task 04.2 — Add PATCH support for planGuide in plans/[id]/route.ts
- Added `planGuide` to the `updates` object type
- Added `'planGuide' in body` guard with null/string handling
- Updated the no-fields guard to include `planGuide` check

### Task 04.3 — Guide Panel above weekly breakdown
- Added `review-guide-panel` section between source pane and week grid
- Textarea with monospace font for guide content
- Auto-saves on blur via 800ms debounce → `PATCH /api/plans/[id]`
- Shows "Saving..." / "Saved ✓" indicator (fades after 2.5s)
- Placeholder text for empty guide

### Task 04.4 — Re-parse button and handler
- "Re-parse Schedule with Current Guide" button inside guide panel
- Disabled while `reparsing || autosaveState.busy || guideSaving`
- Calls `POST /api/plans/[id]/reparse`
- On success: shows result summary (weeks/activities count), calls `loadPlan()` to reload
- On error: shows red error message below button
- Warning note about what re-parse does and doesn't change

### Task 04.5 — Session Instructions per activity
- Added `sessionInstructions` to `ReviewActivity` type and `ActivityDraft` type
- Updated `toActivityDraft()` to include `sessionInstructions`
- Added `expandedSessionInstructions` state (collapsed by default)
- Added "Session Instructions" toggle button in activity action row
- Added collapsible `review-session-instructions-panel` below quick grid
- Activity autosave includes `sessionInstructions` in PATCH body
- Activities API PATCH handler now accepts and saves `sessionInstructions`

## CSS Added (review.css)
- `.review-guide-panel` — card layout with gap
- `.review-guide-head` — flex header for guide section
- `.review-guide-status` — saving/saved indicator
- `.review-guide-textarea` — monospace, resizable
- `.review-guide-actions` — flex row for button + result
- `.review-guide-result` — green result text
- `.review-guide-warning` — small muted warning text
- `.review-session-instructions-panel` — bordered collapsible container

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

Files modified:
- src/app/plans/[id]/review/page.tsx: MODIFIED (guide state, types, callbacks, JSX)
- src/app/plans/[id]/review/review.css: MODIFIED (guide panel + session instructions CSS)
- src/app/api/plans/[id]/route.ts: MODIFIED (planGuide PATCH support)
- src/app/api/plans/[id]/review/activities/[activityId]/route.ts: MODIFIED (sessionInstructions PATCH support)

Commits:
- cc2c8c7: feat(guide-parsing-04): add planGuide PATCH support and sessionInstructions to activity API
- e70c150: feat(guide-parsing-04): add Guide Panel, Re-parse button, and Session Instructions to review page

TypeScript build: PASSED (Compiled successfully in 2.3s, no type errors)
ESLint: No new errors in changed files (pre-existing require() errors in config files are unrelated)

## Self-Check: PASSED
