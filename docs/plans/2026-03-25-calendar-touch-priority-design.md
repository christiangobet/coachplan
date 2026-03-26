# Calendar Touch Priority Design

## Summary

The athlete experience should favor the week-based plan view over the month grid on Apple touch devices. On iPhone 13-sized screens, the current month-first calendar feels cramped and makes the wrong screen primary. On iPad, month view has enough room to remain useful, but tapping a day in the month grid is unreliable because the selected-day panel depends on link-plus-hash behavior that is fragile on touch devices.

The design keeps the desktop calendar unchanged while promoting week view as the default on Apple touch devices. Month view remains available as a deliberate toggle for scanning the month, but it stops being the first experience on iPhone and iPad.

## Goals

- Make `/calendar` open into week view by default on iPhone and iPad.
- Keep month view available as an explicit toggle.
- Preserve the existing desktop month-first behavior.
- Make iPad month view reliably open the selected-day card when the user taps a day.
- Keep the plan-by-week screen feeling like the primary planning surface on touch devices.

## Non-Goals

- Redesign the desktop calendar layout.
- Remove month view from the athlete product.
- Rebuild month view into a new agenda screen.
- Change plan data fetching or logging behavior as part of this pass.

## UX Decisions

### 1. Default view

- When `view` is absent from the URL, Apple touch devices should default to `week`.
- Desktop and non-touch-first devices should keep the current `month` default.
- Explicit URLs such as `?view=month` and `?view=week` always win over device defaults.

### 2. Navigation priority

- The existing `Plan` link remains visible next to the calendar toggle.
- On touch devices, the product should effectively treat plan-by-week as the primary planning experience and week calendar as the default date drill-down experience.
- Month view remains one tap away but is no longer the landing state for iPhone or iPad.

### 3. iPhone month behavior

- Phone month view may keep the existing compact overlay pattern for day details.
- The important change on phone is that users no longer land there by default.

### 4. iPad month behavior

- iPad month view should preserve a side detail card rather than using the phone fullscreen overlay behavior.
- Tapping a month cell should update the selected day in route state and render the day card reliably without depending on `#day-details-card` target behavior as the core mechanism.
- The selected state should remain visible in the month grid after selection.

## Technical Design

### Device-aware defaulting

The calendar route should compute its default view based on device context only when `searchParams.view` is absent. The decision should be centralized in a small shared helper instead of scattering Apple/touch detection logic across the page.

The likely shape is:

- Shared client/runtime helper for Apple touch detection.
- Server-safe fallback behavior that preserves desktop month view.
- Client-side normalization for touch-device entry when the route is opened without an explicit `view`.

### Month-day interaction

The current month grid uses day links that navigate to `?date=...#day-details-card`. That is fine on desktop, but it is brittle on touch devices because:

- iPhone uses a special tap handler to work around scroll-vs-tap behavior.
- iPad still behaves like a touch device but does not fit the same fullscreen overlay assumptions.

The month interaction should be split by form factor:

- Phone: keep the existing tap workaround and overlay-style day-card behavior.
- Tablet: use a direct route-state selection path that opens the right-side day card without depending on hash targeting to reveal the panel.

### CSS behavior

- Phone widths keep the current fullscreen detail card behavior when month view is open.
- Tablet widths should keep the right-side detail card visible and selectable.
- The month cell hit area should remain tappable, but the touch workaround should only own the narrow phone case where it is needed.

## Files Expected To Change

- `src/app/calendar/page.tsx`
- `src/app/calendar/calendar.css`
- `src/components/CalendarDayTapHandler.tsx`
- `src/lib/client-runtime.ts`

## Validation

- iPhone-sized viewport opens `/calendar` into week view by default.
- iPad-sized viewport opens `/calendar` into week view by default.
- iPad month view opens the side day card reliably on day tap.
- Desktop still opens `/calendar` into month view by default.
- Explicit deep links like `?view=month` and `?view=week` still behave exactly as requested.
