# Calendar Touch Priority Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make week view the default calendar entrypoint on Apple touch devices and fix iPad month-view day-card opening without changing desktop behavior.

**Architecture:** Add a small shared device helper so the calendar route can distinguish phone/tablet Apple touch behavior from desktop behavior, then narrow the existing touch tap workaround to phone-sized month view only. Keep the current server-rendered calendar page, but change default-view selection and month-day selection so iPad opens the side detail card from route state instead of depending on hash targeting.

**Tech Stack:** Next.js App Router, React, TypeScript, server components, client helpers, CSS modules/global page CSS, lightweight Node test scripts.

---

### Task 1: Document the device-default behavior in a regression test

**Files:**
- Create: `scripts/calendar-touch-priority.test.ts`
- Modify: `src/app/calendar/page.tsx`
- Modify: `src/lib/client-runtime.ts`

**Step 1: Write the failing test**

Add a Node test that reads the source files and asserts:

- calendar page contains a helper for defaulting to week on Apple touch devices
- client runtime exposes Apple touch detection helpers
- explicit `view` params still short-circuit device defaults

**Step 2: Run test to verify it fails**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: FAIL because the helper names and logic do not exist yet.

**Step 3: Write minimal implementation**

In `src/lib/client-runtime.ts`:

- add a helper for Apple touch detection
- keep it narrow and reusable, for example:
  - `isAppleTouchDevice()`
  - `isPhoneViewport()`
  - `isTabletViewport()`

In `src/app/calendar/page.tsx`:

- add a small resolver that treats `view` as:
  - explicit query value when present
  - `week` for Apple touch devices when absent
  - `month` otherwise

Do not change desktop behavior.

**Step 4: Run test to verify it passes**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/calendar-touch-priority.test.ts src/lib/client-runtime.ts src/app/calendar/page.tsx
git commit -m "test: cover calendar touch-priority defaults"
```

### Task 2: Narrow the month tap workaround to phone month view

**Files:**
- Modify: `src/components/CalendarDayTapHandler.tsx`
- Modify: `src/app/calendar/calendar.css`
- Test: `scripts/calendar-touch-priority.test.ts`

**Step 1: Write the failing test**

Extend `scripts/calendar-touch-priority.test.ts` to assert:

- `CalendarDayTapHandler` checks for phone-sized behavior before hijacking touches
- CSS only disables `.cal-day-hit` pointer events for phone month view, not all touch/tablet cases

**Step 2: Run test to verify it fails**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: FAIL because the handler and CSS still apply the broad mobile path.

**Step 3: Write minimal implementation**

In `src/components/CalendarDayTapHandler.tsx`:

- scope the touchend router-push behavior to phone-sized month view only
- skip the override on iPad/tablet widths
- preserve the existing tap-vs-swipe threshold logic for iPhone

In `src/app/calendar/calendar.css`:

- move `.cal-day-hit { pointer-events: none; }` under the narrow phone breakpoint only
- ensure tablet widths keep direct interaction enabled in month view

**Step 4: Run test to verify it passes**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/calendar-touch-priority.test.ts src/components/CalendarDayTapHandler.tsx src/app/calendar/calendar.css
git commit -m "fix: scope calendar touch handler to phone month view"
```

### Task 3: Make iPad month taps open the side day card reliably

**Files:**
- Modify: `src/app/calendar/page.tsx`
- Modify: `src/app/calendar/calendar.css`
- Test: `scripts/calendar-touch-priority.test.ts`

**Step 1: Write the failing test**

Extend the regression to assert:

- month day hrefs for tablet selection no longer depend on `#day-details-card` as the only opening mechanism
- the month detail card remains the side-card layout outside the phone breakpoint

**Step 2: Run test to verify it fails**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: FAIL because month cells still build hash-based hrefs and the panel relies on target behavior.

**Step 3: Write minimal implementation**

In `src/app/calendar/page.tsx`:

- build month cell selection URLs that always update route state with `date`
- keep hash targeting optional or remove it from the iPad/tablet path
- ensure the right-side day card renders from `selectedDateKey` alone
- keep close links clearing route state correctly

In `src/app/calendar/calendar.css`:

- keep the side-card layout active for tablet widths
- keep fullscreen overlay rules limited to phone widths

**Step 4: Run test to verify it passes**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/calendar-touch-priority.test.ts src/app/calendar/page.tsx src/app/calendar/calendar.css
git commit -m "fix: open calendar day card reliably on ipad month view"
```

### Task 4: Verify explicit view links and entrypoints

**Files:**
- Modify: `src/app/calendar/page.tsx`
- Possibly modify: `src/components/MobileNav.tsx`
- Test: `scripts/calendar-touch-priority.test.ts`

**Step 1: Write the failing test**

Add assertions that:

- explicit `?view=month` is still respected on touch devices
- explicit `?view=week` is still respected on desktop
- links that intentionally go to calendar can preserve or set the correct default route behavior

**Step 2: Run test to verify it fails**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: FAIL if the resolver is too aggressive or the links still assume month-first behavior.

**Step 3: Write minimal implementation**

In `src/app/calendar/page.tsx`:

- keep explicit query values authoritative

In `src/components/MobileNav.tsx` if necessary:

- consider leaving `/calendar` plain and letting the route decide the device default
- do not hardcode a desktop-inappropriate `view` query into the nav unless needed

**Step 4: Run test to verify it passes**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/calendar-touch-priority.test.ts src/app/calendar/page.tsx src/components/MobileNav.tsx
git commit -m "test: preserve explicit calendar view links"
```

### Task 5: Run full verification

**Files:**
- No new files required unless fixes are needed

**Step 1: Run the focused regression**

Run: `node scripts/calendar-touch-priority.test.ts`
Expected: PASS

**Step 2: Run broader checks**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS with only the existing dynamic-server/static-generation warnings already seen elsewhere in the app.

**Step 3: Manual browser verification**

Run these checks in Playwright or browser devtools:

- iPhone 13 viewport:
  - open `/calendar`
  - confirm week view is default
  - switch to month
  - confirm day tap still opens the mobile detail pattern
- iPad viewport:
  - open `/calendar`
  - confirm week view is default
  - switch to month
  - tap a day
  - confirm the side detail card appears reliably
- desktop viewport:
  - open `/calendar`
  - confirm month view is default
  - confirm day selection still opens the detail panel

**Step 4: Final commit**

```bash
git add src/app/calendar/page.tsx src/app/calendar/calendar.css src/components/CalendarDayTapHandler.tsx src/lib/client-runtime.ts scripts/calendar-touch-priority.test.ts
git commit -m "feat: prioritize week calendar view on apple touch devices"
```
