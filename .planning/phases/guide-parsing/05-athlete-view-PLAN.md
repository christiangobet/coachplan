---
wave: 5
depends_on: [04-review-ui-PLAN]
files_modified:
  - src/components/DayLogCard.tsx
  - src/app/calendar/page.tsx
  - src/lib/log-activity.ts
  - src/app/dashboard/dashboard.css
  - src/app/calendar/calendar.css
autonomous: true
---

# Plan 05 — Athlete View: Session Instructions in Day Card + Calendar

## Goal
Surface `sessionInstructions` to the athlete when they open a day on the dashboard or training calendar — as a simple collapsible text block below the activity name, giving them the full execution context for today's workout.

## Context

### Where athletes see workout details
1. **Dashboard today card** — `DashboardDayLogShell` → `DayLogCard` — shows planned activities + log form
2. **Training Calendar day detail** — right sidebar card, uses `DayLogCard` directly

### Data flow
`DayLogCard` receives `activities: LogActivity[]`. The `LogActivity` type is defined in `src/lib/log-activity.ts` and built by `buildLogActivities()`. `sessionInstructions` needs to be added to `LogActivity` and threaded through from the server components.

### Current `LogActivity` type (src/lib/log-activity.ts)
Contains: `id`, `type`, `title`, `completed`, `plannedDistance`, `plannedDuration`, `plannedDetails`, `paceTarget`, `actualDistance`, `actualDuration`, `actualPace`, `distanceUnit`, `notes`.

Missing: `sessionInstructions`.

### Server components that build LogActivity
- `src/app/dashboard/page.tsx` — calls `buildLogActivities(todayActivities, viewerUnits)`
- `src/app/calendar/page.tsx` — calls `buildLogActivities(selectedPlanActivities, viewerUnits)`

Both pass activities from Prisma queries. The Prisma query in both must include `sessionInstructions` in the select.

## Tasks

<task id="05.1" name="Add sessionInstructions to LogActivity type and buildLogActivities">
In `src/lib/log-activity.ts`:

1. Add `sessionInstructions: string | null` to the `LogActivity` type
2. In `buildLogActivities()`, map `sessionInstructions: activity.sessionInstructions ?? null` from the input activity

The input activity type for `buildLogActivities` is whatever the server component passes — ensure the Prisma select includes `sessionInstructions`.
</task>

<task id="05.2" name="Include sessionInstructions in Prisma queries">
In `src/app/dashboard/page.tsx` and `src/app/calendar/page.tsx`, ensure the Prisma queries that load activities include `sessionInstructions` in the select/include.

Search for where `activities: true` or `activities: { select: {...} }` is used in both files and add the field.
</task>

<task id="05.3" name="Show sessionInstructions in DayLogCard ActivityRow">
In `src/components/DayLogCard.tsx`, in the `ActivityRow` component:

After the activity's `cal-activity-workout-row` (which shows the type badge, title, and planned metrics), add a collapsible "How to execute" block:

```tsx
{activity.sessionInstructions && (
  <details className="day-log-instructions">
    <summary className="day-log-instructions-toggle">How to execute</summary>
    <p className="day-log-instructions-text">{activity.sessionInstructions}</p>
  </details>
)}
```

Uses native `<details>`/`<summary>` — no state needed, collapsed by default.

Show for all activity types that have `sessionInstructions` (not just RUN). Do NOT show if `sessionInstructions` is null or empty string.
</task>

<task id="05.4" name="Style the session instructions block">
In `src/app/dashboard/dashboard.css`, add styles for the instructions block used inside `DayLogCard` (which is used by both dashboard and calendar):

```css
.day-log-instructions {
  margin-top: 8px;
}

.day-log-instructions-toggle {
  font-size: 12px;
  font-weight: 600;
  color: var(--d-muted);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}

.day-log-instructions-toggle::before {
  content: '▸';
  font-size: 10px;
  transition: transform 0.15s;
}

details[open] .day-log-instructions-toggle::before {
  transform: rotate(90deg);
}

.day-log-instructions-text {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--d-text-mid);
  white-space: pre-wrap;
  background: var(--d-bg);
  border-radius: var(--d-radius-sm);
  padding: 10px 12px;
  border: 1px solid var(--d-border-light);
}
```
</task>

## Verification

- [ ] `LogActivity` type includes `sessionInstructions: string | null`
- [ ] `buildLogActivities` passes `sessionInstructions` through from the activity record
- [ ] Dashboard today card: opening a day with `sessionInstructions` shows "How to execute" toggle
- [ ] Training calendar day card: same
- [ ] `<details>` is collapsed by default — does not clutter the log form
- [ ] Activities without `sessionInstructions` show no toggle (no empty block)
- [ ] Visually consistent with existing card styles

## must_haves
- `sessionInstructions` block must be collapsed by default — athlete should not be forced to read it
- Show only when `sessionInstructions` is non-null and non-empty
- Applies to all activity types (not just RUN)
- Styling must not break the existing activity log form layout
