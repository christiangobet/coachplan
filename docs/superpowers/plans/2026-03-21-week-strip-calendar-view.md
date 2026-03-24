# Week Strip Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an alternative "Week" view to the existing `/calendar` page that shows a compact 7-day strip (Mon–Sun) with single-char activity codes and completion indicators, borrowed from the Stitch design — accessible via a `?view=week` URL toggle alongside the existing month grid.

**Architecture:** The calendar page is a Next.js server component. We add a `?view=week` and `?week=YYYY-MM-DD` search param. When `view=week`, the month grid is replaced by a new `<WeekStrip>` server component that receives pre-computed `WeekStripDay[]` from the existing `activitiesByDate` / `dayInfoByDate` maps. Day selection continues to use the existing `?date=YYYY-MM-DD` URL pattern so the right-pane `DayLogCard` works unchanged.

**Tech Stack:** Next.js 16 server components, TypeScript, plain CSS (no new libraries). Reuses existing Prisma data already fetched by the calendar page.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/components/WeekStrip.tsx` | **Create** | Server component: renders 7-day week strip with phase/week label, prev/next nav, day cells. No CSS import — styles live in `calendar.css`. |
| `src/app/calendar/calendar.css` | **Modify** | Append `.week-strip-*` and `.cal-mode-pill` styles |
| `src/app/calendar/page.tsx` | **Modify** | Add `view` + `week` to `CalendarSearchParams`; compute `weekDays`; add view toggle buttons; conditionally render `WeekStrip` vs month grid |

> **CSS strategy:** Next.js prohibits importing global CSS files from `src/components/`. The `.week-strip-*` styles go directly into `src/app/calendar/calendar.css`, which is already imported by `page.tsx`. `WeekStrip.tsx` carries no CSS import.

---

## Task 1: WeekStrip component (structure + data types)

**Files:**
- Create: `src/components/WeekStrip.tsx`

### What this component does

Receives pre-shaped data (no DB calls). Renders:
1. A header row: "← Prev" | "Month Year · Phase X / Week Y" | "Next →"
2. A 7-cell row: M T W T F S S — each cell shows the day letter, date number, a single activity-type char, and a status dot/icon.
3. Each cell is a `<Link>` to `?date=YYYY-MM-DD&view=week&week=...` — selecting a day opens the right-pane detail as usual.

### Data type

```typescript
export type WeekStripDay = {
  dateISO: string;          // "2026-03-21"
  dayLetter: string;        // "M" | "T" | "W" | "T" | "F" | "S" | "S"
  dateNum: number;          // 21
  activityCode: string;     // "R" | "C" | "S" | "M" | "Y" | "H" | "?" | "—"
  status: "DONE" | "MISSED" | "PARTIAL" | "OPEN" | null; // null = no plan day
  hasStrava: boolean;       // orange strava dot
  isToday: boolean;
  isSelected: boolean;
  inPlan: boolean;          // has planned activities
  href: string;             // full URL to select this day
};
```

### Steps

- [ ] **Step 1: Create WeekStrip.tsx with types and skeleton**

```tsx
// src/components/WeekStrip.tsx
// NOTE: No CSS import — styles live in src/app/calendar/calendar.css (imported by page.tsx)
import Link from "next/link";

export type WeekStripDay = {
  dateISO: string;
  dayLetter: string;
  dateNum: number;
  activityCode: string;
  status: "DONE" | "MISSED" | "PARTIAL" | "OPEN" | null;
  hasStrava: boolean;
  isToday: boolean;
  isSelected: boolean;
  inPlan: boolean;
  href: string;
};

type WeekStripProps = {
  days: WeekStripDay[];
  weekLabel: string;        // e.g. "March 2026 · Base / Week 4"
  prevWeekHref: string;
  nextWeekHref: string;
};

export default function WeekStrip({ days, weekLabel, prevWeekHref, nextWeekHref }: WeekStripProps) {
  return (
    <div className="week-strip">
      <div className="week-strip-nav">
        <Link className="week-strip-nav-btn" href={prevWeekHref} aria-label="Previous week">← Prev</Link>
        <span className="week-strip-label">{weekLabel}</span>
        <Link className="week-strip-nav-btn" href={nextWeekHref} aria-label="Next week">Next →</Link>
      </div>
      <div className="week-strip-cells">
        {days.map((day) => {
          const cellClass = [
            "week-strip-cell",
            day.isToday ? "wsc-today" : "",
            day.isSelected ? "wsc-selected" : "",
            day.inPlan ? "wsc-in-plan" : "",
            day.status === "DONE" ? "wsc-done" : "",
            day.status === "MISSED" ? "wsc-missed" : "",
            day.status === "PARTIAL" ? "wsc-partial" : "",
          ].filter(Boolean).join(" ");
          return (
            <Link key={day.dateISO} className={cellClass} href={day.href} aria-label={day.dateISO}>
              <span className="wsc-letter">{day.dayLetter}</span>
              <span className="wsc-date">{day.dateNum}</span>
              <span className="wsc-code">{day.inPlan ? day.activityCode : ""}</span>
              <span className="wsc-status-dot" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles — run typecheck**

```bash
cd /Users/christiangobet/CODEX/coachplan && npm run typecheck 2>&1 | tail -20
```
Expected: zero new errors (the CSS import path will be verified in Task 3).

---

## Task 2: Week strip CSS

**Files:**
- Modify: `src/app/calendar/calendar.css` (append at end)

### Design rules (from MASTER.md + existing tokens)
- Use `var(--d-orange)` for selected/today accent, `var(--d-green)` for done status
- Match existing `dashboard.css` token naming
- 7 equal-width columns filling full card width
- Single-letter codes use monospace-style weight (600) and `var(--d-text-mid)` color
- Status dot: 6px circle below the code — green (done), red (missed), orange (partial), hidden (open/no plan)

- [ ] **Step 3: Append week-strip styles to calendar.css**

```css
/* === Week Strip View === */
/* appended to src/app/calendar/calendar.css */

.week-strip {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.week-strip-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  gap: 8px;
}

.week-strip-nav-btn {
  font-size: 13px;
  font-weight: 600;
  color: var(--d-orange);
  text-decoration: none;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.15s;
  flex-shrink: 0;
}
.week-strip-nav-btn:hover {
  background: rgba(252, 76, 2, 0.08);
}

.week-strip-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--d-text);
  text-align: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 7-cell grid */
.week-strip-cells {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-top: 1px solid var(--d-border-light);
}

.week-strip-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 2px 10px;
  text-decoration: none;
  color: var(--d-text);
  transition: background 0.12s;
  position: relative;
  border-right: 1px solid var(--d-border-light);
}
.week-strip-cell:last-child { border-right: none; }
.week-strip-cell:hover { background: var(--d-bg); }

/* Day letter */
.wsc-letter {
  font-size: 10px;
  font-weight: 500;
  color: var(--d-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Date number */
.wsc-date {
  font-size: 16px;
  font-weight: 600;
  color: var(--d-text);
  line-height: 1;
}

/* Activity type code */
.wsc-code {
  font-size: 11px;
  font-weight: 700;
  color: var(--d-text-mid);
  height: 14px;
  line-height: 14px;
}

/* Status dot */
.wsc-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
}

/* State modifiers */
.wsc-today .wsc-date {
  color: var(--d-orange);
}
.wsc-today {
  background: rgba(252, 76, 2, 0.04);
}

.wsc-selected {
  background: rgba(252, 76, 2, 0.08);
}
.wsc-selected .wsc-date {
  color: var(--d-orange);
  font-weight: 800;
}
.wsc-selected::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 10%;
  right: 10%;
  height: 2px;
  background: var(--d-orange);
  border-radius: 1px 1px 0 0;
}

/* Completion status dots */
.wsc-done .wsc-status-dot    { background: var(--d-green); }
.wsc-missed .wsc-status-dot  { background: #d94040; }
.wsc-partial .wsc-status-dot { background: var(--d-orange); }

/* No plan day: dim code + date */
.week-strip-cell:not(.wsc-in-plan) .wsc-date { color: var(--d-muted); font-weight: 400; }
```

- [ ] **Step 4: Quick sanity check that calendar.css is parseable**

```bash
node -e "require('fs').readFileSync('./src/app/calendar/calendar.css', 'utf8'); console.log('CSS file OK')"
```
Expected: `CSS file OK`

---

## Task 3: Wire WeekStrip into calendar page

**Files:**
- Modify: `src/app/calendar/page.tsx`

This task has several sub-steps. Make one change at a time, typecheck after each.

### 3a: Extend CalendarSearchParams and add helper functions

- [ ] **Step 5: Add `view` and `week` to CalendarSearchParams, and add week date helpers**

Find the `CalendarSearchParams` type (line ~40) and the helper functions block. Add:

In `CalendarSearchParams`:
```typescript
type CalendarSearchParams = {
  plan?: string;
  month?: string;
  date?: string;
  returnTo?: string;
  view?: string;   // "week" | "month" (default "month")
  week?: string;   // YYYY-MM-DD of the Monday — only used when view=week
};
```

After the existing `addMonths` function, add these helpers (around line ~193):
```typescript
/** Returns the ISO Monday (Mon=1) of the week containing `value`. */
function getWeekMonday(value: Date): Date {
  const d = normalizeDate(value);
  const isoDay = getIsoDay(d); // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDay - 1));
  return d;
}

/** Add `delta` weeks to `value`. */
function addWeeks(value: Date, delta: number): Date {
  const d = normalizeDate(value);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d;
}

/** Build the URL for week view: preserves plan, date, and returnTo. */
function buildWeekHref(
  weekMonday: Date,
  planId: string,
  selectedDate?: string | null,
  returnTo?: string | null
): string {
  const params = new URLSearchParams();
  params.set("view", "week");
  params.set("week", dateKey(weekMonday));
  if (planId) params.set("plan", planId);
  if (selectedDate) params.set("date", selectedDate);
  if (returnTo) params.set("returnTo", returnTo);
  return `/calendar?${params.toString()}`;
}
```

- [ ] **Step 6: Typecheck after adding helpers**

```bash
cd /Users/christiangobet/CODEX/coachplan && npm run typecheck 2>&1 | tail -10
```
Expected: no new errors.

### 3b: Resolve week view params in the server component body

- [ ] **Step 7: Add view/week resolution after existing params are parsed (around line ~357)**

After the line `const returnToDashboard = requestedReturnTo === "dashboard";`, add:

```typescript
const requestedView = typeof params.view === "string" ? params.view : "month";
const isWeekView = requestedView === "week";
const requestedWeek = typeof params.week === "string" ? params.week : undefined;
```

After the `today` const (around line ~600), add week computation:

```typescript
// Week view: resolve the Monday of the displayed week
// Cache parseDateParam result to avoid calling it twice (returns a new Date object each call)
const parsedWeekParam = parseDateParam(requestedWeek);
const weekMonday = isWeekView
  ? (parsedWeekParam ? getWeekMonday(parsedWeekParam) : getWeekMonday(today))
  : getWeekMonday(today); // unused in month view but computed once cheaply

const prevWeekHref = buildWeekHref(addWeeks(weekMonday, -1), selectedPlan.id, selectedDateKey, returnToParam);
const nextWeekHref = buildWeekHref(addWeeks(weekMonday, 1), selectedPlan.id, selectedDateKey, returnToParam);
```

- [ ] **Step 8: Typecheck**

```bash
cd /Users/christiangobet/CODEX/coachplan && npm run typecheck 2>&1 | tail -10
```
Expected: no new errors.

### 3c: Build WeekStripDay[] from existing maps

- [ ] **Step 9: Add weekDays computation after the `prevWeekHref`/`nextWeekHref` block**

Note: The `import type { WeekStripDay }` must go at the **top of the file** with other imports (Step 10), NOT inline here.

```typescript
// Activity type → single-char strip code
const STRIP_CODE: Record<string, string> = {
  RUN: "R",
  CROSS_TRAIN: "C",
  STRENGTH: "S",
  MOBILITY: "M",
  YOGA: "Y",
  HIKE: "H",
  REST: "—",
  OTHER: "?"
};

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

const weekDays: WeekStripDay[] = Array.from({ length: 7 }, (_, i) => {
  // Simple UTC date copy — weekMonday is already UTC midnight
  const d = new Date(weekMonday);
  d.setUTCDate(weekMonday.getUTCDate() + i);
  const key = dateKey(d);
  const dayActivities = activitiesByDate.get(key) || [];
  const dayLogs = externalByDate.get(key) || [];
  const dayInfo = dayInfoByDate.get(key) || null;
  const inPlan = planDateKeys.has(key);

  // Resolve status (same logic as month grid)
  const manualStatus = dayInfo?.manualStatus || "OPEN";
  const autoDone = dayActivities.length > 0 && dayActivities.every((a) => a.completed);
  const status: WeekStripDay["status"] = inPlan
    ? (autoDone ? "DONE" : manualStatus as "DONE" | "MISSED" | "PARTIAL" | "OPEN")
    : null;

  // Primary activity code: first non-REST activity (REST last by sort), or REST if only type
  const primary = dayActivities.find((a) => a.type !== "REST") || dayActivities[0] || null;
  const activityCode = primary ? (STRIP_CODE[primary.type] ?? "?") : "—";

  const hasStrava = dayLogs.some((l) => l.provider === "STRAVA");

  // No #day-details-card hash — the hash only works if the element already exists in the DOM.
  // On first load (no date selected yet) the right-pane card is not rendered, so the hash
  // would cause a scroll-to-top. The ?date= param alone is sufficient to open the card.
  const href = buildWeekHref(weekMonday, selectedPlan.id, key, returnToParam);

  return {
    dateISO: key,
    dayLetter: DAY_LETTERS[i],
    dateNum: d.getUTCDate(),
    activityCode,
    status,
    hasStrava,
    isToday: key === dateKey(today),
    isSelected: key === selectedDateKey,
    inPlan,
    href,
  };
});
```

Note: The `import type { WeekStripDay }` line goes at the top of the file with other imports, not inline.

- [ ] **Step 10: Add the import at the top of page.tsx (with other component imports)**

Find the block of component imports (around line ~21–31) and add:
```typescript
import WeekStrip from "@/components/WeekStrip";
import type { WeekStripDay } from "@/components/WeekStrip";
```

- [ ] **Step 11: Build weekLabel string**

The week label shows "March 2026 · Week 4". Add after `weekDays` computation.

> **Performance note:** The `weeks.find()` loop below calls `resolveWeekBounds` again — the same function is already called in the `activitiesByDate` loop and the `activeCurrentWeekIndex` IIFE. For a typical plan (12–20 weeks) this is negligible, but a future optimization could cache bounds in a `Map<number, ResolvedWeekBounds>`. Acceptable for MVP.

```typescript
const weekLabelParts: string[] = [
  formatMonthLabel(weekMonday),
];
// Find the plan week that contains the displayed weekMonday
const displayedPlanWeek = weeks.find((week) => {
  const bounds = resolveWeekBounds({
    weekIndex: week.weekIndex,
    weekStartDate: week.startDate,
    weekEndDate: week.endDate,
    raceDate: selectedPlan.raceDate,
    weekCount: selectedPlan.weekCount,
    allWeekIndexes
  });
  if (!bounds.startDate || !bounds.endDate) return false;
  return weekMonday >= bounds.startDate && weekMonday <= bounds.endDate;
});
if (displayedPlanWeek) {
  weekLabelParts.push(`Week ${displayedPlanWeek.weekIndex}`);
}
const weekLabel = weekLabelParts.join(" · ");
```

- [ ] **Step 12: Typecheck**

```bash
cd /Users/christiangobet/CODEX/coachplan && npm run typecheck 2>&1 | tail -10
```
Expected: no new errors.

### 3d: View toggle buttons + conditional render

- [ ] **Step 13: Add view toggle to the calendar header**

Find the `cal-view-toggle` div (around line ~728):
```tsx
<div className="cal-view-toggle" aria-label="Plan views">
  <Link className="cal-view-pill" href={`/plans/${selectedPlan.id}`}>Plan</Link>
  <span className="cal-view-pill active">Training Calendar</span>
  <Link className="cal-view-pill" href="/strava">Import Strava</Link>
</div>
```

Replace with:
```tsx
<div className="cal-view-toggle" aria-label="Plan views">
  <Link className="cal-view-pill" href={`/plans/${selectedPlan.id}`}>Plan</Link>
  {isWeekView ? (
    <Link
      className="cal-view-pill"
      href={buildCalendarHref(monthStart, selectedPlan.id, selectedDateKey, returnToParam)}
    >
      Training Calendar
    </Link>
  ) : (
    <span className="cal-view-pill active">Training Calendar</span>
  )}
  <Link className="cal-view-pill" href="/strava">Import Strava</Link>
</div>
```

Also add a Month/Week sub-toggle (inside `cal-header-actions`, after the existing toggle):
```tsx
<div className="cal-view-mode-toggle" aria-label="Calendar layout">
  {isWeekView ? (
    <Link
      className="cal-mode-pill"
      href={buildCalendarHref(monthStart, selectedPlan.id, selectedDateKey, returnToParam)}
    >
      Month
    </Link>
  ) : (
    <span className="cal-mode-pill active">Month</span>
  )}
  {isWeekView ? (
    <span className="cal-mode-pill active">Week</span>
  ) : (
    <Link
      className="cal-mode-pill"
      href={buildWeekHref(weekMonday, selectedPlan.id, selectedDateKey, returnToParam)}
    >
      Week
    </Link>
  )}
</div>
```

- [ ] **Step 14: Replace month grid with conditional render**

Find the `<div className="dash-card cal-month-card">` block (around line ~796). Wrap the entire `<div className="cal-month-scroll">` contents in a conditional:

```tsx
<div className="dash-card cal-month-card">
  {isWeekView ? (
    <WeekStrip
      days={weekDays}
      weekLabel={weekLabel}
      prevWeekHref={prevWeekHref}
      nextWeekHref={nextWeekHref}
    />
  ) : (
    <>
      <div className="cal-month-nav-row">
        {/* existing month nav unchanged */}
      </div>
      <div className="cal-month-scroll">
        {/* existing month grid unchanged */}
      </div>
    </>
  )}
</div>
```

- [ ] **Step 15: Typecheck**

```bash
cd /Users/christiangobet/CODEX/coachplan && npm run typecheck 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 16: Add cal-mode-pill styles to calendar.css**

The `.week-strip-*` styles were already appended in Task 2 (Step 3). Now add the Mode Toggle pill styles. Find the existing `.cal-view-pill` block in `calendar.css` and add after it:

```css
/* Month / Week sub-toggle */
.cal-view-mode-toggle {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.cal-mode-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid var(--d-border);
  color: var(--d-text-mid);
  text-decoration: none;
  background: var(--d-raised);
  transition: background 0.15s;
}
.cal-mode-pill:hover { background: var(--d-bg); }
.cal-mode-pill.active {
  background: var(--d-orange);
  color: #fff;
  border-color: var(--d-orange);
}
```

---

## Task 4: Verification

- [ ] **Step 17: Run full verify suite**

```bash
cd /Users/christiangobet/CODEX/coachplan && npm run verify 2>&1 | tail -20
```
Expected: passes (typecheck + lint + build).

- [ ] **Step 18: Start dev server and test manually**

```bash
npm run dev
```

Navigate to http://localhost:3001/calendar — should show month view as before.
Navigate to http://localhost:3001/calendar?view=week — should show week strip.
Click "Week" toggle pill → switches to week view.
Click "Month" toggle pill → switches back.
Click a day cell in week strip → right pane opens with day detail.
Click prev/next week → navigates to adjacent week.
Verify: today is highlighted orange, done days show green dot, missed days show red dot.

- [ ] **Step 19: Screenshot week view on mobile (390px)**

Use Playwright or browser devtools at 390px width. Confirm 7 cells fit without overflow, text is legible.

- [ ] **Step 20: Commit**

```bash
git add src/components/WeekStrip.tsx src/app/calendar/page.tsx src/app/calendar/calendar.css
git commit -m "feat: add week strip view to training calendar

Alternative compact 7-day strip layout inspired by Stitch design.
Toggle via ?view=week param. Shows activity type codes, completion
dots, and phase/week label. Day selection opens existing right-pane
detail unchanged."
```

---

## Out of scope (future iterations)
- Inline day expand (client-side expand without URL navigation)
- Strava orange dot in strip cells (data available, just omitted from MVP)
- Swipe left/right on strip to navigate weeks (needs client component + touch handler)
- Phase name in week label (requires plan phase structure not yet in schema)
