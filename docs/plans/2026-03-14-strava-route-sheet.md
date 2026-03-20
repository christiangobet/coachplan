# Strava Route Sheet Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a Strava route entry point in the athlete's daily activity log and open the route in a mobile-first bottom sheet for completed workouts that have stored route geometry.

**Architecture:** Extend the existing daily log data shape with a small route-preview payload derived from matched `ExternalActivity.raw`, extract/decode the route in a dedicated helper, and render the route in a lazily opened bottom sheet from `DashboardActivityLogCard`. Phase 1 uses a lightweight SVG route renderer rather than a heavyweight tile-map dependency.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma, existing dashboard/calendar CSS, Node test runner

---

### Task 1: Add Strava route extraction helpers

**Files:**
- Create: `src/lib/strava-route.ts`
- Test: `scripts/strava-route.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildStravaRoutePreview } from "@/lib/strava-route";

test("buildStravaRoutePreview reads summary polyline and metrics from Strava raw payload", () => {
  const preview = buildStravaRoutePreview({
    name: "Morning Trail Run",
    sportType: "TrailRun",
    startTime: new Date("2026-03-13T07:15:00Z"),
    distanceM: 12800,
    movingTimeSec: 4980,
    elevationGainM: 640,
    raw: {
      map: { summary_polyline: "encoded-polyline" }
    }
  });

  assert.equal(preview?.hasRoute, true);
  assert.equal(preview?.name, "Morning Trail Run");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types scripts/strava-route.test.ts`
Expected: FAIL because `src/lib/strava-route.ts` does not exist yet.

**Step 3: Write minimal implementation**

Create `src/lib/strava-route.ts` with:

- `extractStravaPolyline(raw: unknown): string | null`
- `decodePolyline(encoded: string): Array<{ lat: number; lng: number }>`
- `normalizeRouteForSvg(points): Array<{ x: number; y: number }>`
- `buildStravaRoutePreview(...)`

Minimal output shape:

```ts
export type StravaRoutePreview = {
  hasRoute: boolean;
  name: string | null;
  sportType: string | null;
  startTime: string;
  distanceM: number | null;
  movingTimeSec: number | null;
  elevationGainM: number | null;
  polyline: string;
  svgPoints: Array<{ x: number; y: number }>;
};
```

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types scripts/strava-route.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/strava-route.ts scripts/strava-route.test.ts
git commit -m "feat: add strava route preview helpers"
```

### Task 2: Extend daily-log activity data with route preview info

**Files:**
- Modify: `src/lib/log-activity.ts`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/calendar/page.tsx`
- Test: `scripts/log-activity-route-preview.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildLogActivities } from "@/lib/log-activity";

test("buildLogActivities includes route preview when a matched Strava activity has route geometry", () => {
  const activities = buildLogActivities([
    {
      id: "activity-1",
      title: "Trail Run",
      type: "RUN",
      completed: true,
      externalActivities: [
        {
          name: "Trail Run",
          sportType: "TrailRun",
          startTime: new Date("2026-03-13T07:15:00Z"),
          distanceM: 12800,
          movingTimeSec: 4980,
          elevationGainM: 640,
          raw: { map: { summary_polyline: "encoded-polyline" } }
        }
      ]
    }
  ], "KM");

  assert.equal(activities[0].routePreview?.hasRoute, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types scripts/log-activity-route-preview.test.ts`
Expected: FAIL because `routePreview` is not part of `LogActivity`.

**Step 3: Write minimal implementation**

- Extend `LogActivity` in `src/lib/log-activity.ts` with `routePreview`
- Call `buildStravaRoutePreview` from the first matched external activity, if present
- Update the plan queries in `src/app/dashboard/page.tsx` and `src/app/calendar/page.tsx` so `activities` include the matched `externalActivities` relation with the needed fields:
  - `name`
  - `sportType`
  - `startTime`
  - `distanceM`
  - `movingTimeSec`
  - `elevationGainM`
  - `raw`

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types scripts/log-activity-route-preview.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/log-activity.ts src/app/dashboard/page.tsx src/app/calendar/page.tsx scripts/log-activity-route-preview.test.ts
git commit -m "feat: wire strava route previews into daily log data"
```

### Task 3: Add a route trigger to completed activity rows

**Files:**
- Modify: `src/components/DashboardActivityLogCard.tsx`
- Modify: `src/app/dashboard/dashboard.css`
- Test: `scripts/dashboard-activity-route-trigger.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("dashboard activity log renders a route trigger for workouts with route preview data", async () => {
  const source = await readFile(path.join(process.cwd(), "src/components/DashboardActivityLogCard.tsx"), "utf8");
  assert.match(source, /View route/);
  assert.match(source, /activity\.routePreview/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types scripts/dashboard-activity-route-trigger.test.ts`
Expected: FAIL because no route trigger exists yet.

**Step 3: Write minimal implementation**

In `src/components/DashboardActivityLogCard.tsx`:

- add local state for `selectedRouteActivityId`
- render a `View route` button only when:
  - activity is completed
  - `activity.routePreview?.hasRoute === true`
- keep the trigger secondary in the hierarchy

In `src/app/dashboard/dashboard.css`:

- add compact route-trigger styles that fit inside the existing activity row
- ensure the trigger remains legible on iPhone and in dark mode

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types scripts/dashboard-activity-route-trigger.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/DashboardActivityLogCard.tsx src/app/dashboard/dashboard.css scripts/dashboard-activity-route-trigger.test.ts
git commit -m "feat: add route trigger to completed activity rows"
```

### Task 4: Build the route bottom sheet

**Files:**
- Create: `src/components/ActivityRouteSheet.tsx`
- Modify: `src/components/DashboardActivityLogCard.tsx`
- Modify: `src/app/dashboard/dashboard.css`
- Test: `scripts/activity-route-sheet.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("activity route sheet exposes mobile dialog semantics and route metadata", async () => {
  const source = await readFile(path.join(process.cwd(), "src/components/ActivityRouteSheet.tsx"), "utf8");
  assert.match(source, /role=\"dialog\"/);
  assert.match(source, /aria-modal=\"true\"/);
  assert.match(source, /Imported from Strava/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types scripts/activity-route-sheet.test.ts`
Expected: FAIL because the sheet component does not exist yet.

**Step 3: Write minimal implementation**

Create `src/components/ActivityRouteSheet.tsx`:

- accepts a `routePreview`
- renders:
  - scrim
  - drag handle
  - title/date
  - SVG route visualization
  - distance, moving time, elevation gain
  - `Imported from Strava`
- only mounts when open
- supports close on scrim and close button

Update `DashboardActivityLogCard.tsx` to:

- open the sheet from the tapped activity row
- close it without disturbing log state

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types scripts/activity-route-sheet.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ActivityRouteSheet.tsx src/components/DashboardActivityLogCard.tsx src/app/dashboard/dashboard.css scripts/activity-route-sheet.test.ts
git commit -m "feat: add bottom-sheet strava route viewer"
```

### Task 5: Add graceful fallbacks and mobile polish

**Files:**
- Modify: `src/components/ActivityRouteSheet.tsx`
- Modify: `src/app/dashboard/dashboard.css`
- Test: `scripts/activity-route-sheet.test.ts`

**Step 1: Write the failing test**

```ts
test("activity route sheet handles missing or invalid geometry gracefully", async () => {
  const source = await readFile(path.join(process.cwd(), "src/components/ActivityRouteSheet.tsx"), "utf8");
  assert.match(source, /Route map unavailable for this activity/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types scripts/activity-route-sheet.test.ts`
Expected: FAIL because fallback copy is missing.

**Step 3: Write minimal implementation**

- add a user-friendly fallback when decode/normalization fails
- tune bottom-sheet spacing for iPhone keyboard/safe-area conventions
- ensure dark mode colors stay readable

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types scripts/activity-route-sheet.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ActivityRouteSheet.tsx src/app/dashboard/dashboard.css scripts/activity-route-sheet.test.ts
git commit -m "fix: harden strava route sheet fallbacks"
```

### Task 6: Run end-to-end verification for dashboard and calendar daily logs

**Files:**
- Verify: `src/app/dashboard/page.tsx`
- Verify: `src/app/calendar/page.tsx`
- Verify: `src/components/DashboardActivityLogCard.tsx`
- Verify: `src/components/ActivityRouteSheet.tsx`

**Step 1: Run targeted tests**

Run:

```bash
node --test --experimental-strip-types scripts/strava-route.test.ts
node --test --experimental-strip-types scripts/log-activity-route-preview.test.ts
node --test --experimental-strip-types scripts/dashboard-activity-route-trigger.test.ts
node --test --experimental-strip-types scripts/activity-route-sheet.test.ts
```

Expected: all PASS

**Step 2: Run project verification**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: exit code `0` for both

**Step 3: Manual verification checklist**

- dashboard daily log shows `View route` only for completed Strava-matched activities with route geometry
- tapping `View route` opens a bottom sheet on iPhone-sized viewport
- route sheet closes cleanly and returns the athlete to the same log position
- workouts without geometry show no new route UI
- calendar daily log behavior matches dashboard behavior
- dark mode remains legible

**Step 4: Commit**

```bash
git add src/lib/strava-route.ts src/lib/log-activity.ts src/app/dashboard/page.tsx src/app/calendar/page.tsx src/components/DashboardActivityLogCard.tsx src/components/ActivityRouteSheet.tsx src/app/dashboard/dashboard.css scripts/strava-route.test.ts scripts/log-activity-route-preview.test.ts scripts/dashboard-activity-route-trigger.test.ts scripts/activity-route-sheet.test.ts
git commit -m "feat: show strava routes in daily activity log"
```
