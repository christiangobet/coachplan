# Calendar & Plan Detail UX Fixes

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 UX/iOS issues across the Calendar and Plan Detail pages identified in the UI/UX review.

**Architecture:** Pure CSS + one component removal. No new files. All changes are in `calendar.css`, `review.css`, and `page.tsx` (CalendarMobileDoubleTap removal).

**Tech Stack:** Next.js, CSS custom properties, iOS Safari constraints

---

## Chunk 1: Critical iOS fixes

### Task 1: Remove conflicting double-tap component

**Files:**
- Modify: `src/app/calendar/page.tsx` — remove import + JSX usage of CalendarMobileDoubleTap

**Background:** `CalendarDayTapHandler` already handles single-tap navigation via `touchend`. `CalendarMobileDoubleTap` runs a competing touchend handler that queues taps and only navigates on double-tap — but since `CalendarDayTapHandler` already navigated, the double-tap logic never fires. The component only provides a 700ms click deduplication side-effect, which is now unnecessary since `CalendarDayTapHandler` calls `e.preventDefault()` itself. Removing `CalendarMobileDoubleTap` simplifies the event handling.

- [ ] In `src/app/calendar/page.tsx`, remove the import line for `CalendarMobileDoubleTap`
- [ ] Remove the `<CalendarMobileDoubleTap />` JSX element from the component tree
- [ ] Run `npm run typecheck` — expect 0 errors

---

### Task 2: Fix iOS input auto-zoom (font-size < 16px)

**Files:**
- Modify: `src/app/calendar/calendar.css` lines ~1191 and ~1282

iOS Safari auto-zooms the viewport on any `<input>` or `<textarea>` with `font-size < 16px`. Two elements trigger this.

- [ ] Find `.cal-race-editor-form input` — change `font-size: 13px` → `font-size: 16px`
- [ ] Find `.cal-day-missed-reason` — change `font-size: 13px` → `font-size: 16px`
- [ ] Run `npm run typecheck`

---

### Task 3: Fix close button touch target (only exit on mobile)

**Files:**
- Modify: `src/app/calendar/calendar.css` — `.cal-detail-close`

The close button is the **only** way to dismiss the full-screen day panel on iPhone. At 30×30px it fails Apple's 44px minimum. Fix:

- [ ] Find `.cal-detail-close` block — change `width: 30px; height: 30px` → `min-width: 44px; min-height: 44px`
- [ ] Run `npm run typecheck`

---

## Chunk 2: Touch targets & interaction polish

### Task 4: Raise all pill touch targets to 44px minimum

**Files:**
- Modify: `src/app/calendar/calendar.css`

Elements below 44px min-height:
- `.cal-view-pill` (30px) — view switcher (primary nav)
- `.cal-plan-pill` (32px) — plan switcher
- `.cal-selected-plan-toggle` (32px) — toggle
- `.cal-links a`, `.cal-links .cal-strava-sync-btn`, `.cal-links .cal-quick-disabled` (34px)

- [ ] `.cal-view-pill`: change `min-height: 30px` → `min-height: 44px`
- [ ] `.cal-plan-pill`: change `min-height: 32px` → `min-height: 44px`
- [ ] `.cal-selected-plan-toggle`: change `min-height: 32px` → `min-height: 44px`
- [ ] `.cal-links a, .cal-links .cal-strava-sync-btn, .cal-links .cal-quick-disabled`: change `min-height: 34px` → `min-height: 44px`
- [ ] Run `npm run typecheck`

---

### Task 5: Add `touch-action: manipulation` and `-webkit-tap-highlight-color` to interactive elements

**Files:**
- Modify: `src/app/calendar/calendar.css`

Missing `touch-action: manipulation` causes 300ms tap delay on iPhone for all pill/button elements. Missing `-webkit-tap-highlight-color: transparent` causes default iOS blue flash.

Add to each of these blocks:
```css
touch-action: manipulation;
-webkit-tap-highlight-color: transparent;
```

Elements:
- `.cal-view-pill`
- `.cal-plan-pill`
- `.cal-month-btn`
- `.cal-selected-plan-toggle`
- `.cal-links a`
- `.cal-links .cal-strava-sync-btn`
- `.cal-detail-close`

- [ ] Add both properties to each element listed above
- [ ] Run `npm run typecheck`

---

### Task 6: Add `cursor: pointer` to `.cal-plan-pill`

**Files:**
- Modify: `src/app/calendar/calendar.css` — `.cal-plan-pill` block

- [ ] Find `.cal-plan-pill` — add `cursor: pointer;`
- [ ] Run `npm run typecheck`

---

## Chunk 3: Font sizes & active state

### Task 7: Raise sub-readable data label font sizes to minimum 11px

**Files:**
- Modify: `src/app/calendar/calendar.css`

Elements with illegible font sizes on iPhone:

| Selector | Current | Fix |
|---|---|---|
| `.cal-day-dist` | 9px | 11px |
| `.cal-pace-badge` | 9.5px | 11px |
| `.cal-run-distance` | 9px | 11px |
| `.cal-activity-code` | 10px | 11px |
| `.cal-strava-pill-more` | 10px | 11px |
| `.cal-match-badge` | 10px | 11px |
| `.cal-activity-done-dot` label text | 10px | 11px |

- [ ] Update each selector's `font-size` to the value in the Fix column above
- [ ] Run `npm run typecheck`

---

### Task 8: Make active view pill visually distinct

**Files:**
- Modify: `src/app/calendar/calendar.css` — `.cal-view-pill.active`

Currently `.cal-view-pill.active` only adds a subtle `box-shadow` on the same background. In dark mode this is invisible. Add a solid background so the active state is immediately readable:

```css
.cal-view-pill.active {
  background: var(--d-text);
  color: var(--d-raised);
  box-shadow: var(--d-shadow);
}
```

And ensure dark mode also respects this:
```css
[data-theme="dark"] .cal-view-pill.active {
  background: var(--d-text);
  color: var(--d-raised);
}
```

- [ ] Update `.cal-view-pill.active` as above
- [ ] Add dark mode override near the bottom of calendar.css in the existing `[data-theme="dark"]` block
- [ ] Run `npm run typecheck`

---

## Chunk 4: Review page (Plan Detail)

### Task 9: Fix `100vh` → `100dvh` in sticky source pane

**Files:**
- Modify: `src/app/plans/[id]/review/review.css` lines 44–45

On iOS Safari, `100vh` includes the browser chrome height. This causes the sticky PDF source pane to overflow on iPhone.

- [ ] Find `.review-page-shell.with-source-pane .review-source-pane`
- [ ] Change `height: calc(100vh - 84px)` → `height: calc(100dvh - 84px)`
- [ ] Change `max-height: calc(100vh - 84px)` → `max-height: calc(100dvh - 84px)`
- [ ] Run `npm run typecheck`

---

### Task 10: Raise review form action buttons to 44px minimum

**Files:**
- Modify: `src/app/plans/[id]/review/review.css`

Review form buttons at 34px, 36px, and 38px min-height — below 44px. Find and update all button/action elements with `min-height` below 44px.

- [ ] Search for `min-height: 34px`, `min-height: 36px`, `min-height: 38px` in review.css
- [ ] Change each to `min-height: 44px`
- [ ] Run `npm run typecheck`

---

## Final verification

- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 errors
- [ ] Visual check on dev server at http://localhost:3001/calendar
- [ ] Resize browser to 390px width and verify: pills are tappable, close button is large, no text is 9–10px
