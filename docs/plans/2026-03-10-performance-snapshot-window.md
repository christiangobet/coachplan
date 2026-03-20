# Performance Snapshot — Configurable Lookback Window

> **Status: COMPLETED** — implemented and merged to main

**Date:** 2026-03-10
**Status:** Approved — ready for implementation

---

## Problem

The Performance Snapshot card uses a hardcoded 84-day primary window (falling back to 180 days). Users with rich Strava history can't explore how their estimates change over longer periods, and users who synced only recently can't extend the window to get better estimates.

---

## Solution

Add a segmented window selector (4w / 8w / 12w / 6m / 12m) to the card. When the user selects a window:
- If the DB already has sufficient data → recompute silently
- If data is missing → show an inline prompt to fetch from Strava, then recompute

Default: **12w** (84 days) — no regression from current behaviour.

---

## UI

Segmented control sits at the top of the Performance Snapshot card, left-aligned. "Recalculate" button stays on the right.

**State: data available**
```
[4w] [8w] [12w] [6m] [12m]          Recalculate
Estimated 5K     35:54
...
MEDIUM · 74%
Based on 2 race-like runs and 4 recent efforts.
```

**State: needs sync**
```
[4w] [8w] [12w] [6m] [12m]          Recalculate
⚠ Only 6 weeks of runs are synced.
Fetch 6 months from Strava to use this window?
[Fetch from Strava]
```

**State: fetching**
Button shows "Fetching…", status line "Syncing 6 months of history…"
After sync completes → auto-recomputes and shows result.

---

## Window Options

| Label | lookbackDays |
|-------|-------------|
| 4w    | 28          |
| 8w    | 56          |
| 12w   | 84 (default)|
| 6m    | 180         |
| 12m   | 365         |

---

## API Changes

### `GET /api/profile/performance-snapshot`

New query param: `lookbackDays` (default: 84).

New response status:
```ts
{ status: 'needs_sync', dataAvailableDays: 42, requestedDays: 180 }
```

Existing statuses unchanged: `ready`, `insufficient_data`, `disconnected`, `error`.

### Data availability check

Before computing, check the oldest synced Strava activity:
```ts
const oldest = await prisma.externalActivity.findFirst({
  where: { userId, provider: 'STRAVA' },
  orderBy: { startTime: 'asc' },
  select: { startTime: true }
});
const dataAvailableDays = (Date.now() - oldest.startTime.getTime()) / 86400000;
if (dataAvailableDays < lookbackDays * 0.8) {
  return { status: 'needs_sync', dataAvailableDays: Math.floor(dataAvailableDays), requestedDays: lookbackDays };
}
```

The 0.8 threshold gives 20% tolerance (e.g. requesting 180 days only needs 144 days synced).

### Sync trigger

Reuses existing `POST /api/integrations/strava/sync`:
```ts
{ lookbackDays: selectedWindow, forceLookback: true }
```

After sync, profile page auto-calls snapshot endpoint with `refresh=true`.

---

## `performance-snapshot.ts` Changes

- `computeSnapshot` accepts `lookbackDays: number` parameter
- Replaces hardcoded `PRIMARY_WINDOW_DAYS` (84) / `MAX_WINDOW_DAYS` (180) with the user-supplied value
- Single window, no fallback expansion (user explicitly chose the window)
- Caching unchanged: keyed on `lastSyncAt`; any new sync invalidates

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/performance-snapshot.ts` | Add `lookbackDays` param to `computeSnapshot` + `getOrRefreshPerformanceSnapshotForUser`; add data-availability check returning `needs_sync` |
| `src/app/api/profile/performance-snapshot/route.ts` | Read `lookbackDays` from query params; pass to lib; handle `needs_sync` response |
| `src/app/profile/page.tsx` | Add window state (default 84), segmented control, `needs_sync` prompt + fetch button, fetch→recompute flow |

**No schema changes. No new API endpoints.**
