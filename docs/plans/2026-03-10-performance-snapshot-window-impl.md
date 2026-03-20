# Performance Snapshot Configurable Window — Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 5-option window selector (4w/8w/12w/6m/12m) to the Performance Snapshot card, with an inline prompt to fetch more Strava history when the selected window exceeds what's synced.

**Architecture:** Three-layer change: (1) `performance-snapshot.ts` accepts `lookbackDays` and checks data availability, returning a new `needs_sync` status; (2) the API route passes `lookbackDays` from query params and handles the new status; (3) the profile page adds window state, a segmented control, and a fetch-then-recompute flow.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma (existing stack — no new dependencies).

---

## Task 1: Update `performance-snapshot.ts` — accept `lookbackDays` + data availability check

**Files:**
- Modify: `src/lib/performance-snapshot.ts`

**Key changes:**
- `computeSnapshot` gains `lookbackDays: number` param (replaces hardcoded 84/180)
- `getOrRefreshPerformanceSnapshotForUser` gains `lookbackDays?: number` (default 84)
- New return status: `{ status: 'NEEDS_SYNC', dataAvailableDays: number, requestedDays: number }`
- Data availability check runs before `computeSnapshot`

**Step 1: Update `PerformanceSnapshotResult` type to include `NEEDS_SYNC`**

In `src/lib/performance-snapshot.ts`, change:
```ts
export type PerformanceSnapshotResult =
  | { status: 'READY'; snapshot: ReadyPerformanceSnapshot; cached: boolean }
  | { status: 'INSUFFICIENT_DATA'; reason: string; cached: boolean }
  | { status: 'DISCONNECTED'; reason: string };
```
To:
```ts
export type PerformanceSnapshotResult =
  | { status: 'READY'; snapshot: ReadyPerformanceSnapshot; cached: boolean }
  | { status: 'INSUFFICIENT_DATA'; reason: string; cached: boolean }
  | { status: 'DISCONNECTED'; reason: string }
  | { status: 'NEEDS_SYNC'; dataAvailableDays: number; requestedDays: number };
```

**Step 2: Add `lookbackDays` param to `computeSnapshot`**

Change the function signature:
```ts
async function computeSnapshot(args: {
  userId: string;
  lastSyncAt: Date | null;
  lookbackDays: number;
}): Promise<...>
```

Replace the `since` calculation (currently uses hardcoded `MAX_WINDOW_DAYS`):
```ts
// OLD
const since = new Date(Date.now() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);

// NEW
const since = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000);
```

Remove the two-window fallback logic (lines 242-244):
```ts
// DELETE these lines:
const primaryWindow = runLike.filter((activity) => isRecent(activity.startTime, PRIMARY_WINDOW_DAYS));
const selectedWindowDays = primaryWindow.length >= 2 ? PRIMARY_WINDOW_DAYS : MAX_WINDOW_DAYS;
const sourceRuns = selectedWindowDays === PRIMARY_WINDOW_DAYS ? primaryWindow : runLike;

// REPLACE with:
const sourceRuns = runLike;
const selectedWindowDays = args.lookbackDays;
```

Pass `lookbackDays` when calling `computeSnapshot` (in `getOrRefreshPerformanceSnapshotForUser`):
```ts
const computed = await computeSnapshot({
  userId: args.userId,
  lastSyncAt: account.lastSyncAt,
  lookbackDays: args.lookbackDays ?? 84
});
```

**Step 3: Add data availability check to `getOrRefreshPerformanceSnapshotForUser`**

Add `lookbackDays?: number` to the args type:
```ts
export async function getOrRefreshPerformanceSnapshotForUser(args: {
  userId: string;
  forceRefresh?: boolean;
  lookbackDays?: number;
}): Promise<PerformanceSnapshotResult> {
```

After the `if (!account?.isActive)` check, add:
```ts
const requestedDays = args.lookbackDays ?? 84;

// Check if DB has enough data for the requested window
const oldestActivity = await prisma.externalActivity.findFirst({
  where: { userId: args.userId, provider: IntegrationProvider.STRAVA },
  orderBy: { startTime: 'asc' },
  select: { startTime: true }
});

if (oldestActivity) {
  const dataAvailableDays = (Date.now() - oldestActivity.startTime.getTime()) / (1000 * 60 * 60 * 24);
  if (dataAvailableDays < requestedDays * 0.8) {
    return {
      status: 'NEEDS_SYNC',
      dataAvailableDays: Math.floor(dataAvailableDays),
      requestedDays
    };
  }
}
```

**Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

**Step 5: Commit**

```bash
git add src/lib/performance-snapshot.ts
git commit -m "feat: performance-snapshot accepts lookbackDays, adds NEEDS_SYNC status"
```

---

## Task 2: Update the API route to pass `lookbackDays`

**Files:**
- Modify: `src/app/api/profile/performance-snapshot/route.ts`

**Step 1: Read `lookbackDays` from query params and handle `needs_sync`**

Replace the entire route with:
```ts
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { getOrRefreshPerformanceSnapshotForUser } from '@/lib/performance-snapshot';

function toBoolean(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dbUser = await ensureUserFromAuth(authUser, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  try {
    const url = new URL(req.url);
    const refresh = toBoolean(url.searchParams.get('refresh'));
    const lookbackDays = toPositiveInt(url.searchParams.get('lookbackDays'), 84);

    const result = await getOrRefreshPerformanceSnapshotForUser({
      userId: dbUser.id,
      forceRefresh: refresh,
      lookbackDays
    });

    if (result.status === 'NEEDS_SYNC') {
      return NextResponse.json({
        status: 'needs_sync',
        snapshot: null,
        dataAvailableDays: result.dataAvailableDays,
        requestedDays: result.requestedDays
      });
    }
    if (result.status === 'DISCONNECTED') {
      return NextResponse.json({ status: 'disconnected', snapshot: null, reason: result.reason });
    }
    if (result.status === 'INSUFFICIENT_DATA') {
      return NextResponse.json({ status: 'insufficient_data', snapshot: null, reason: result.reason, cached: result.cached });
    }

    return NextResponse.json({ status: 'ready', snapshot: result.snapshot, cached: result.cached });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build performance snapshot';
    return NextResponse.json({ status: 'error', snapshot: null, reason: message }, { status: 500 });
  }
}
```

**Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

**Step 3: Commit**

```bash
git add src/app/api/profile/performance-snapshot/route.ts
git commit -m "feat: performance-snapshot API passes lookbackDays, handles needs_sync"
```

---

## Task 3: Update profile page — window state, segmented control, fetch flow

**Files:**
- Modify: `src/app/profile/page.tsx`

**Step 1: Add window constants and state**

After the existing `PACE_ZONE_DEFS` constant, add:
```ts
const SNAPSHOT_WINDOWS = [
  { label: '4w', days: 28 },
  { label: '8w', days: 56 },
  { label: '12w', days: 84 },
  { label: '6m', days: 180 },
  { label: '12m', days: 365 }
] as const;

const DEFAULT_SNAPSHOT_WINDOW = 84;
```

Update `PerformanceSnapshotResponse` type to include `needs_sync`:
```ts
type PerformanceSnapshotResponse = {
  status: 'ready' | 'insufficient_data' | 'disconnected' | 'error' | 'needs_sync';
  snapshot?: ReadyPerformanceSnapshot | null;
  reason?: string | null;
  cached?: boolean;
  dataAvailableDays?: number;
  requestedDays?: number;
};
```

Add state variables (alongside the existing `performanceStatus` state):
```ts
const [snapshotWindowDays, setSnapshotWindowDays] = useState(DEFAULT_SNAPSHOT_WINDOW);
const [snapshotNeedsSyncDays, setSnapshotNeedsSyncDays] = useState<{ available: number; requested: number } | null>(null);
const [snapshotFetching, setSnapshotFetching] = useState(false);
```

**Step 2: Update `loadPerformanceSnapshot` to pass `snapshotWindowDays`**

Change the function signature to accept an optional `windowDays` override:
```ts
const loadPerformanceSnapshot = useCallback(async (forceRefresh = false, windowDays?: number) => {
```

Update the fetch URL:
```ts
// OLD
const query = forceRefresh ? '?refresh=1' : '';
const res = await fetch(`/api/profile/performance-snapshot${query}`, { cache: 'no-store' });

// NEW
const days = windowDays ?? snapshotWindowDays;
const params = new URLSearchParams({ lookbackDays: String(days) });
if (forceRefresh) params.set('refresh', '1');
const res = await fetch(`/api/profile/performance-snapshot?${params}`, { cache: 'no-store' });
```

Add `needs_sync` handling inside the function (after the `disconnected` check):
```ts
if (data.status === 'needs_sync') {
  setPerformanceStatus('needs_sync' as typeof performanceStatus);
  setPerformanceSnapshot(null);
  setSnapshotNeedsSyncDays({
    available: data.dataAvailableDays ?? 0,
    requested: data.requestedDays ?? days
  });
  return;
}
```

Clear `snapshotNeedsSyncDays` when a result comes back:
```ts
// At the start of the ready/insufficient_data handlers, add:
setSnapshotNeedsSyncDays(null);
```

Add `snapshotWindowDays` to the `useCallback` dependency array.

**Step 3: Add window change handler**

```ts
async function handleWindowChange(days: number) {
  setSnapshotWindowDays(days);
  setSnapshotNeedsSyncDays(null);
  await loadPerformanceSnapshot(false, days);
}
```

**Step 4: Add `fetchAndRecompute` function**

```ts
async function fetchAndRecompute() {
  if (!snapshotNeedsSyncDays) return;
  setSnapshotFetching(true);
  setIntegrationStatus(`Syncing ${snapshotWindowDays} days of Strava history...`);
  try {
    const res = await fetch('/api/integrations/strava/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookbackDays: snapshotWindowDays, forceLookback: true })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setIntegrationStatus(data?.error || 'Sync failed');
      return;
    }
    setIntegrationStatus(null);
    await loadIntegrationStatus();
    await loadPerformanceSnapshot(true, snapshotWindowDays);
  } catch {
    setIntegrationStatus('Sync failed. Please try again.');
  } finally {
    setSnapshotFetching(false);
  }
}
```

**Step 5: Update the Performance Snapshot card JSX**

Replace the existing card header:
```tsx
{/* Performance snapshot card */}
<div className="dash-card profile-performance-card">
  <div className="profile-performance-header">
    <h3>Performance Snapshot (Estimated)</h3>
    <button
      type="button"
      className="profile-performance-refresh-btn"
      onClick={() => void loadPerformanceSnapshot(true)}
      disabled={!stravaAccount?.connected || performanceRefreshing}
    >
      {performanceRefreshing ? 'Recalculating...' : 'Recalculate'}
    </button>
  </div>
```

With:
```tsx
{/* Performance snapshot card */}
<div className="dash-card profile-performance-card">
  <div className="profile-performance-header">
    <h3>Performance Snapshot (Estimated)</h3>
    <button
      type="button"
      className="profile-performance-refresh-btn"
      onClick={() => void loadPerformanceSnapshot(true)}
      disabled={!stravaAccount?.connected || performanceRefreshing || snapshotFetching}
    >
      {performanceRefreshing ? 'Recalculating...' : 'Recalculate'}
    </button>
  </div>

  {/* Window selector */}
  {stravaAccount?.connected && (
    <div className="profile-snapshot-windows">
      {SNAPSHOT_WINDOWS.map(({ label, days }) => (
        <button
          key={days}
          type="button"
          className={`profile-snapshot-window-btn${snapshotWindowDays === days ? ' active' : ''}`}
          onClick={() => void handleWindowChange(days)}
          disabled={performanceRefreshing || snapshotFetching}
        >
          {label}
        </button>
      ))}
    </div>
  )}
```

Add `needs_sync` state display (after the `insufficient_data` block):
```tsx
{(performanceStatus as string) === 'needs_sync' && snapshotNeedsSyncDays && (
  <div className="profile-performance-needs-sync">
    <p className="profile-performance-note">
      ⚠ Only {snapshotNeedsSyncDays.available} days of runs are synced.
    </p>
    <p className="profile-performance-hint">
      Fetch {Math.round(snapshotNeedsSyncDays.requested / 30)} months from Strava to use this window?
    </p>
    <button
      type="button"
      className="cta secondary"
      onClick={() => void fetchAndRecompute()}
      disabled={snapshotFetching}
    >
      {snapshotFetching ? 'Fetching...' : 'Fetch from Strava'}
    </button>
  </div>
)}
```

**Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors

**Step 7: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat: performance snapshot window selector with Strava fetch prompt"
```

---

## Task 4: Add CSS for window selector

**Files:**
- Modify: `src/app/profile/profile.css`

**Step 1: Add styles**

Append to `src/app/profile/profile.css`:
```css
/* ── Snapshot window selector ── */
.profile-snapshot-windows {
  display: flex;
  gap: 4px;
  margin-bottom: 0.75rem;
}

.profile-snapshot-window-btn {
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--d-border);
  background: none;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--d-muted);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.profile-snapshot-window-btn:hover {
  background: var(--d-border-light);
  color: var(--d-text);
}

.profile-snapshot-window-btn.active {
  background: var(--d-orange);
  border-color: var(--d-orange);
  color: #fff;
}

.profile-snapshot-window-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Needs-sync prompt */
.profile-performance-needs-sync {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
```

**Step 2: Verify lint**

Run: `npm run lint`
Expected: clean

**Step 3: Commit**

```bash
git add src/app/profile/profile.css
git commit -m "feat: add window selector styles to profile.css"
```

---

## Task 5: Manual verification

**Step 1: Start dev server**

Run: `npm run dev` (runs on http://localhost:3001)

**Step 2: Navigate to `/profile`**

Check:
- [ ] Segmented window control shows 4w / 8w / 12w / 6m / 12m — 12w active by default
- [ ] Clicking 4w or 8w recomputes with that window (if data available)
- [ ] Clicking 6m or 12m when data isn't available shows the ⚠ sync prompt
- [ ] "Fetch from Strava" triggers sync with correct `lookbackDays`, then recomputes
- [ ] "Recalculate" still works with the active window
- [ ] Disconnected state: window selector hidden

**Step 3: Push**

```bash
git push origin main
```
