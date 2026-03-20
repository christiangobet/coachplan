# Athlete iPhone Audit Findings

> **Status: COMPLETED** — implemented and merged to main

> Audit date: 2026-03-13
> Viewports: iPhone 13 Pro `390x844`
> Browser: Playwright (Mobile Safari emulation)
> Screenshots: `artifacts/iphone-audit/`

---

## Summary

- Screens audited: 12 (landing, sign-in, dashboard, plans, plan-detail, calendar, calendar+day-panel, progress, profile, upload, strava)
- P0 count: 2
- P1 count: 7
- P2 count: 8

---

## Recurring Patterns

**Bottom nav dark mode tokens missing**
- Routes affected: all authenticated routes
- User impact: `MobileNav.module.css` hardcodes `background: #fff` and `border-top: 1px solid #e5e5e5`. When the user toggles dark mode the bottom nav bar stays white, clashing with the dark page background.
- Likely fix area: `src/components/MobileNav.module.css` — replace with `var(--d-raised)` and `var(--d-border)` tokens.

**Plan filter chip lists wrap to multiple rows on mobile**
- Routes affected: `/progress`, `/plans`
- User impact: Long plan name pills wrap to 3-4 rows pushing primary content below the fold. Athletes cannot see their stats or plan cards without scrolling past the filter chrome.
- Likely fix area: `src/app/progress/progress.css`, `src/app/plans/plans.css` — add `overflow-x: auto; flex-wrap: nowrap` at `≤480px` or replace with a native `<select>`.

**MobileNav shown on unauthenticated routes**
- Routes affected: `/`, `/sign-in`
- User impact: The bottom tab bar (Today, Calendar, Plans, Strava, Progress) shows on the public landing and sign-in pages. All tabs require auth, so tapping them bounces the user to sign-in. Confusing for a new visitor.
- Likely fix area: `src/components/MobileNav.tsx` — gate render on auth state, or in `src/app/layout.tsx` suppress on public routes.

**Strava icon clusters in calendar cells**
- Routes affected: `/calendar`
- User impact: Multiple Strava activity icons per day cell stack horizontally in cells compressed to ~55px wide at 390px. Text labels (activity names and distances) become illegible and adjacent cells are easy to mis-tap.
- Likely fix area: `src/app/calendar/calendar.css` — at `≤640px` limit displayed Strava icons to 1 with a +N overflow badge.

---

## P0 Findings

### [P0] `/calendar?date=YYYY-MM-DD` — Day detail panel completely invisible on mobile

- Device: iPhone 13 Pro (390x844)
- State: URL contains `?date=2026-03-13` with `#day-details-card` anchor
- Problem: The `#day-details-card` element lives inside `<aside class="dash-right cal-right">`. On all viewports below 1380px, `dashboard.css` applies `.dash-right { display: none }`. Because `display: none` on a parent element collapses all descendants regardless of their own `position: fixed`, the entire day panel has `offsetWidth: 0` and `offsetHeight: 0` and is invisible. The CSS in `calendar.css` at `max-width: 768px` correctly sets `.cal-day-details-card.is-open { position: fixed; inset: 0; width: 100vw; height: 100dvh }` but this never takes effect because the parent is hidden.
- User impact: Tapping any calendar day on iPhone produces no visible response. The athlete cannot view workout details, log activities, or mark days complete from the calendar — the app's primary daily interaction flow is broken on mobile.
- Evidence: `artifacts/iphone-audit/08-calendar-day-panel-bug.png` — panel absent from viewport despite `is-open` class; JS evaluation confirms `offsetHeight: 0`.
- Root cause files:
  - `src/app/dashboard/dashboard.css` line 3060: `.dash-right { display: none; }` at `max-width: 1380px`
  - `src/app/dashboard/dashboard.css` line 3081: `.dash-right { display: none; }` at `max-width: 768px`
  - `src/app/calendar/page.tsx` line 1029: `<aside className="dash-right cal-right">` is the parent of `#day-details-card`
- Recommendation: Move `#day-details-card` out of the `aside` in `calendar/page.tsx` so it renders as a direct sibling of the main grid (or inside `<body>` via a portal). This eliminates the hidden-parent problem entirely. Alternatively, add to `calendar.css`: `.cal-page.cal-day-open .cal-right { display: block !important; position: fixed; inset: 0; width: 0; height: 0; overflow: visible; pointer-events: none; }` and add `pointer-events: auto` on `#day-details-card` directly — though the JSX restructuring is cleaner.

---

### [P0] `/sign-in` — Clerk form below the fold; primary CTA requires scrolling

- Device: iPhone 13 Pro (390x844)
- State: Default (signed-out visitor)
- Problem: The sign-in layout renders a large dark hero panel (~360px tall at 390px viewport) with a background photo, marketing headline, and bullet points before the Clerk sign-in form begins. The email input field starts at approximately y=540px — below the fold. Additionally, the "Back home" link text inside the hero card is clipped at the right edge, rendering as "Back ho" (text overflow without ellipsis).
- User impact: Athletes returning to sign in must scroll before they can tap the email field. If the iOS virtual keyboard opens when the email field gains focus, the form may be partially or fully obscured. The clipped "Back home" link is confusing.
- Evidence: `artifacts/iphone-audit/02-sign-in-viewport.png`
- Recommendation: In the sign-in page layout, add `@media (max-width: 480px) { .sign-in-hero { display: none; } }` (or reduce to a compact strip `max-height: 60px`). Fix the clip by adding `overflow: hidden; white-space: nowrap; text-overflow: ellipsis` or increasing the hero card horizontal padding so the link fits.

---

## P1 Findings

### [P1] `/` (Landing) — Duplicate navigation bars at top of page

- Device: iPhone 13 Pro (390x844)
- State: Signed out
- Problem: Two separate header/nav bars stack at the top: the global app `<header>` renders "Sign in" and "Create account" buttons, and immediately below it the landing page component renders its own identical navigation bar with logo and the same links. The doubled header consumes ~110px before the hero content begins.
- User impact: Looks broken. The visible viewport shows half the hero headline with duplicate nav above it. The primary CTA "Start for free" button is still visible on first load but the duplicate chrome creates visual noise.
- Evidence: `artifacts/iphone-audit/01-landing-viewport.png`
- Recommendation: Suppress the global header on the `/` route, or ensure the landing page component does not render its own nav when the global header is visible. Check `src/app/layout.tsx` to conditionally hide the header on the landing route.

### [P1] `/plans` — Filter chips wrap to 3 rows; active plan card not visible on first screen

- Device: iPhone 13 Pro (390x844)
- State: User with 5 plan categories
- Problem: The "Jump to" section renders 5 pill buttons (Active 3, Draft 1, Archived 4, My Templates 5, Public Templates 1) in a flex-wrap row. At 390px they wrap to 3 rows. Combined with the search bar and "Upload Plan" CTA button, the athlete must scroll before seeing the first active plan card.
- User impact: The athlete's most important action (continue active plan) is hidden below the fold behind filter chrome.
- Evidence: `artifacts/iphone-audit/05-plans-viewport.png`
- Recommendation: In `src/app/plans/plans.css`, at `≤480px`: `overflow-x: auto; flex-wrap: nowrap; white-space: nowrap` on the jump-to chip row so it becomes a single horizontal scroll strip.

### [P1] `/progress` — Plan and window chip rows bury stats below fold

- Device: iPhone 13 Pro (390x844)
- State: User with 8 plans
- Problem: The progress page renders 8 plan name pills (wrapping to ~4 rows) and 3 window pills before any stat cards. The first stat card ("88% Workout Completion") starts at approximately y=580px — 74% of the way down the 844px viewport.
- User impact: The athlete landing on Progress sees a grid of plan names, not their metrics.
- Evidence: `artifacts/iphone-audit/09-progress-viewport.png`
- Recommendation: In `src/app/progress/progress.css`, at `≤480px` collapse the plan selector to a native `<select>` element. Keep the 3-pill window switcher (it fits on one row).

### [P1] `/calendar` — 7-column grid too dense; text and icons illegible at 390px

- Device: iPhone 13 Pro (390x844)
- State: Month with multiple activities per day
- Problem: At 390px the 7-day grid renders each column at ~55px. Activity type badges (RUN, STR, XT, RST) are readable but stacked with distances and Strava icon clusters make cells overflow. The `@media (max-width: 640px)` rule sets `min-width: 560px` which forces a horizontal overflow, but since the calendar container does not have `overflow-x: auto`, cells are actually rendered narrower than the min-width hint intends.
- User impact: Athletes misidentify workout types. Multi-activity days are too dense to read. Tap targets for adjacent days overlap at small widths.
- Evidence: `artifacts/iphone-audit/07-calendar-viewport.png`
- Recommendation: In `src/app/calendar/calendar.css` at `≤480px`: (a) reduce each cell to showing only the activity type badge + completion dot, hiding distance/pace; (b) add `overflow-x: auto` to the calendar wrapper so the `min-width: 560px` actually produces a horizontally scrollable grid rather than compressed cells; or (c) implement a week-strip view as the default mobile layout.

### [P1] `/plans/[id]` — Full-width "Coach" floating button obscures day grid rows

- Device: iPhone 13 Pro (390x844)
- State: Plan detail, Coach widget collapsed
- Problem: The Coach trigger button is `position: fixed; left: 12px; right: 12px; bottom: calc(12px + 56px + env(safe-area-inset-bottom))` — full-width and approximately 52px tall. It sits directly above the bottom nav and covers the bottom row of the visible plan day grid. Users scrolling through weekly cards see the last visible day entry cut off by the button.
- User impact: Day entries at the bottom of the viewport are partially hidden. The button does not hide when scrolling.
- Evidence: `artifacts/iphone-audit/06-plan-detail-viewport.png`
- Recommendation: In `src/app/plans/plans.css`, reduce the Coach trigger to a compact circular FAB (`width: 56px; height: 56px; border-radius: 50%`) positioned `right: 16px` rather than full-width.

### [P1] `/dashboard` — Today's workout card below the fold on first paint

- Device: iPhone 13 Pro (390x844)
- State: Active plan with weekly metrics
- Problem: The dashboard renders: (1) page heading, (2) plan hero card with race info, (3) weekly metrics section, then (4) "TODAY · FRIDAY, MARCH 13" workout card. The TODAY card starts at approximately y=510px on first load. The athlete's primary action — viewing and logging today's workout — requires scrolling.
- User impact: The athlete sees plan metadata and metrics before the actionable today card. On a training morning, the first-screen content does not answer "what do I do today?"
- Evidence: `artifacts/iphone-audit/04-dashboard-viewport.png`
- Recommendation: Reorder mobile dashboard sections: (1) heading, (2) TODAY workout card, (3) plan hero/metrics. This can be done with `order` CSS property on the flex/grid children at `≤768px` without changing desktop layout.

### [P1] `/strava` — Import row explanatory text and "Open in Calendar" link truncated

- Device: iPhone 13 Pro (390x844)
- State: Strava connected, import table showing
- Problem: Each import row's action section shows "Open in Calendar to Reopen Day" link text that wraps and truncates in the compact card layout. The text at the bottom of longer rows clips outside the visible card area on the full-page scroll view.
- User impact: Athletes cannot read the full instruction for handling closed days.
- Evidence: `artifacts/iphone-audit/12-strava-full.png`
- Recommendation: In `src/app/strava/strava.css`, at `≤480px` reduce the helper text font size to 11px or place it in a collapsible hint section.

---

## P2 Findings

### [P2] `/` + `/sign-in` — MobileNav visible on unauthenticated pages

- Device: iPhone 13 Pro (390x844)
- State: Signed out
- Problem: The bottom tab bar renders on the public landing page and sign-in page, showing authenticated app routes. All five tabs redirect to sign-in if tapped.
- User impact: A new visitor sees app navigation tabs on the landing page — confusing about authentication state.
- Evidence: `artifacts/iphone-audit/01-landing-viewport.png`, `artifacts/iphone-audit/02-sign-in-viewport.png`
- Recommendation: In `src/components/MobileNav.tsx`, wrap render with a Clerk `useAuth()` check: only render when `isSignedIn === true`. Or in `src/app/layout.tsx`, gate the component.

### [P2] `MobileNav` — Hardcoded white background breaks in dark mode

- Routes affected: all authenticated routes
- Problem: `src/components/MobileNav.module.css` line 13: `background: #fff` and line 14: `border-top: 1px solid #e5e5e5`. No `[data-theme="dark"]` override.
- Recommendation: Replace with `background: var(--d-raised, #fff)` and `border-top: 1px solid var(--d-border, #e5e5e5)`.

### [P2] `/profile` — Strava "Disconnect" destructive action has same visual weight as "Sync now"

- Device: iPhone 13 Pro (390x844)
- State: Strava connected
- Problem: Three Strava buttons stack: "Sync now" (bordered), "Disconnect" (bordered), "Reconnect" (bordered). "Disconnect" is a destructive action that would break the Strava sync workflow, but it has identical visual styling to the safe "Sync now" button. All three are adjacent on a 390px screen.
- User impact: Easy accidental tap of "Disconnect" while targeting "Sync now".
- Evidence: `artifacts/iphone-audit/10-profile-viewport.png`
- Recommendation: Style "Disconnect" as a ghost button with `color: var(--d-error, #b42318)` and `border-color: var(--d-error)`. Hide "Reconnect" unless `status === 'error'` or `status === 'disconnected'`.

### [P2] `/plans/[id]` — "Edit Plan" button text potentially invisible over hero photo

- Device: iPhone 13 Pro (390x844)
- State: Plan detail header
- Problem: The "Edit Plan" button sits over a background photo in the plan hero card. The button appears to have no background scrim, relying on the photo's dark area for contrast. Depending on the photo, the white button text can become unreadable.
- Evidence: `artifacts/iphone-audit/06-plan-detail-viewport.png`
- Recommendation: In `src/app/plans/plans.css`, add `background: rgba(0,0,0,0.4); backdrop-filter: blur(4px)` to the Edit Plan button within the hero image context.

### [P2] `/upload` — Race date native picker conflicts with `dd.mm.yyyy` placeholder

- Device: iPhone 13 Pro (390x844)
- State: Default (empty form)
- Problem: The race date input has a `dd.mm.yyyy` placeholder but uses `type="date"` which invokes the native iOS date wheel. The placeholder text is redundant and won't appear during native picker interaction.
- Recommendation: Remove the format placeholder; add a visible label or helper text below the field showing the currently selected date in human-readable form once a date is chosen.

### [P2] `/calendar` — Month prev/next buttons below recommended 44×44px tap target

- Device: iPhone 13 Pro (390x844)
- State: Calendar view
- Problem: "← Prev" and "Next →" links are approximately 55×32px. The minimum Apple/Google HIG tap target is 44×44px.
- Evidence: `artifacts/iphone-audit/07-calendar-viewport.png`
- Recommendation: In `src/app/calendar/calendar.css`, add `min-height: 44px; padding: 10px 16px` to the calendar month navigation links.

### [P2] `/progress` — "Review this week adjustments" CTA button text truncates

- Device: iPhone 13 Pro (390x844)
- State: Progress page top
- Problem: "Review this week adjustments" and "Go to Today" render side-by-side. The longer button label truncates on 390px.
- Evidence: `artifacts/iphone-audit/09-progress-viewport.png`
- Recommendation: Stack buttons vertically at `≤480px`, or shorten the label to "Review & Adjust" in `src/app/progress/` component.

---

## Recommended Fix Batches

### Batch 1 — P0 blockers

1. **Calendar day panel invisible on mobile** — Restructure `calendar/page.tsx` to render `#day-details-card` outside the `aside.dash-right.cal-right` (e.g. as a sibling of `.dash-grid`, or portal to `<body>`). This is the single highest-priority fix — it breaks the app's core daily interaction flow.
2. **Sign-in form below fold** — Collapse or hide the hero panel at `≤480px` in the sign-in layout; fix "Back home" text overflow.

### Batch 2 — Repeated layout/interaction issues

3. Plan filter chip rows (Plans + Progress) → horizontal scroll strip at ≤480px
4. Dashboard card ordering → TODAY card first on mobile via CSS `order`
5. Calendar grid density → overflow-x scroll + reduced cell content at ≤480px
6. Plan detail Coach button → compact FAB
7. Strava import helper text → smaller font or collapsible

### Batch 3 — Polish

8. MobileNav: dark mode token fix + hide on unauthenticated routes
9. Profile: Disconnect button destructive styling
10. Plan hero: Edit Plan button contrast scrim
11. Upload: remove redundant date format placeholder
12. Calendar: month nav tap target sizing
13. Progress: shorten CTA button label

---

## Implementation Hotspots

Files requiring the most changes, in order:

1. **`src/app/calendar/page.tsx`** — Move `#day-details-card` out of the aside (P0 fix)
2. **`src/app/calendar/calendar.css`** — Mobile cell density, month nav tap targets, potential overflow-x scroll
3. **`src/app/dashboard/dashboard.css`** — Root source of P0 via `.dash-right { display: none }` (may not need change if JSX restructured)
4. **`src/components/MobileNav.module.css`** + **`MobileNav.tsx`** — Dark mode tokens + auth gate
5. **`src/app/plans/plans.css`** + **`src/app/progress/progress.css`** — Filter chip horizontal scroll
6. **`src/app/sign-in/` (layout or page CSS)** — Hero collapse on mobile
7. **`src/app/profile/profile.css`** — Destructive button styling
8. **`src/app/dashboard/dashboard.css`** — Section order on mobile (`order` property)

---

## Success Criteria for Phase 1 Completion

- [ ] All P0 issues resolved and verified on 390px viewport
- [ ] All P1 issues have accepted fix or documented deferral
- [ ] Recurring patterns addressed with shared CSS token or utility class
