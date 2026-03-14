# Strava Route Sheet Design

## Summary

Add a route preview entry point to the athlete's daily activity log and open the route in a mobile-first bottom sheet when tapped.

The primary user is the athlete reviewing a completed, Strava-matched workout on iPhone. The job is fast recognition of "what route did I actually do?" without leaving the daily log or overwhelming the workout card.

## Problem

The app already imports Strava activity data, but the athlete cannot see the route shape for a completed workout where that route is often the most memorable and useful piece of context. The daily log currently shows metrics and completion state, but not the path that was actually covered.

Adding a full map directly into the log would hurt scanability and mobile performance. The feature needs to feel lightweight in the row and rich only on demand.

## Options Considered

### Option A: Always-visible inline route map

- Pros: route is immediately visible
- Cons: too heavy for the daily log, adds visual clutter, poor fit for iPhone

### Option B: Compact route trigger in the log, bottom sheet on tap

- Pros: best mobile hierarchy, preserves scanability, gives the route enough room when needed
- Cons: requires one extra tap

### Option C: Dedicated activity detail page

- Pros: clean long-term expansion path for richer activity detail
- Cons: too much scope for the first version, breaks the "stay in the log" flow

## Recommendation

Choose Option B.

Show a compact `View route` affordance only for completed activities that are matched to a Strava activity with route geometry. Tapping it opens a bottom sheet with a larger route view and key metrics.

## Scope

### In scope

- Athlete daily activity log on dashboard and calendar flows
- Strava-matched completed workouts only
- Route data read from already-stored Strava payloads
- Bottom sheet route presentation on tap
- Graceful fallback when no route geometry is available

### Out of scope

- GPX upload or GPX file parsing
- Changing Strava sync behavior
- New standalone activity detail pages
- Reworking the broader daily log information architecture
- True base-map tiles in phase 1 if the existing data only supports route geometry

## Data Strategy

The app already stores the provider payload for imported Strava activities in `ExternalActivity.raw`. Phase 1 should read route geometry from that stored payload instead of introducing a new sync or upload path.

Expected geometry sources, in priority order:

1. `raw.map.summary_polyline`
2. `raw.map.polyline`
3. no route UI when neither exists

The UI payload should stay small. The daily log should receive a compact route-preview object per activity, containing only:

- whether a route exists
- encoded route geometry or normalized route points
- activity name
- sport type
- start time
- distance
- moving time
- elevation gain

## Rendering Strategy

Phase 1 should not add a heavyweight map dependency unless strictly necessary. The recommended renderer is a custom SVG route visualization derived from Strava polyline geometry and displayed inside the bottom sheet.

Why this is preferred:

- no external tile provider setup
- lighter on iPhone Safari
- faster to lazy-load
- less regression risk than adding a full mapping stack

This is still a route map for the athlete's purpose, even without geographic base tiles. If a true interactive tile map is later desired, the same route payload can support a phase-2 upgrade.

## User Flow

1. Athlete opens the daily activity log.
2. A completed workout row with Strava route data shows a small `View route` trigger.
3. Athlete taps `View route`.
4. A bottom sheet opens with the workout route and summary metrics.
5. Athlete closes the sheet and returns to the exact place in the log.

## UI Design

### In the activity row

Show a secondary route affordance below the existing workout summary, not at the same visual weight as completion actions.

Suggested content:

- small route glyph or mini route thumbnail
- `View route`
- optional short metric line such as distance and moving time

The row should remain unchanged for workouts without route geometry.

### In the bottom sheet

The sheet should follow the mobile patterns already used in the app:

- drag handle
- compact header with workout title
- close control
- safe-area-aware bottom spacing

Content order:

1. route visualization
2. activity title and sport/date context
3. compact metrics row: distance, moving time, elevation gain when available
4. quiet source label: `Imported from Strava`

### Empty and error states

- No route geometry: no `View route` affordance at all
- Decode/render failure: show `Route map unavailable for this activity`
- Missing metrics: omit missing values instead of showing placeholders

## Architecture Impact

The daily log currently receives simplified `LogActivity` objects. That shape needs to be extended so route preview data can travel with the already-rendered completed workout rows.

Likely touchpoints:

- `src/lib/log-activity.ts`
- `src/app/dashboard/page.tsx`
- `src/app/calendar/page.tsx`
- `src/components/DashboardActivityLogCard.tsx`

The route extraction/normalization logic should live in a dedicated Strava route helper rather than inside the component tree.

## Accessibility

- `View route` must be a real button
- bottom sheet should use dialog semantics on mobile
- route visualization needs a text alternative, for example `Trail route preview for yesterday's hike`
- all route stats must remain available as text, not only visually

## Performance

- do not mount the route sheet content until opened
- keep the closed-state row lightweight
- avoid adding a heavy mapping library for phase 1
- compute normalized SVG path once per opened activity, not on every render

## Risks

### Incomplete route data

Some Strava activities will not include route geometry. The UI must simply omit the feature in those cases.

### Geometry decode errors

Polyline decoding and normalization need tests so malformed provider payloads fail safely.

### Visual overload

The route affordance must remain secondary inside the log so it does not compete with workout completion and sync controls.

## Success Criteria

- completed Strava-matched workouts with route data show a clear route entry point
- tapping the entry point opens a bottom sheet that feels natural on iPhone
- workouts without route data remain visually unchanged
- the daily activity log stays fast and readable
- no new regressions in dashboard/calendar activity logging flows
