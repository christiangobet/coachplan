# iPhone Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all P0/P1/P2 issues found in the 2026-03-13 athlete iPhone audit, organized into three sequential fix batches.

**Architecture:** Pure CSS fixes where possible; minimal JSX changes only where CSS cannot solve the problem. All changes are additive media-query overrides except where noted. No new components. No new pages.

**Tech Stack:** Next.js 16, React 19, TypeScript, global CSS + per-route CSS modules, Clerk auth (`useAuth`), CSS custom properties (`--d-*` tokens).

**Findings reference:** `docs/plans/2026-03-13-athlete-iphone-audit-findings.md`

---

## Chunk 1: Batch 1 — P0 Blockers

### Task 1: Fix calendar day panel invisible on mobile

**Root cause:** `#day-details-card` lives inside `<aside class="dash-right cal-right">`. `dashboard.css` sets `.dash-right { display: none }` at `max-width: 1380px` AND `max-width: 768px`. A `display: none` parent collapses even `position: fixed` children to zero size — so the fullscreen day overlay never renders.

**Files:**
- Modify: `src/app/calendar/calendar.css`

**Fix strategy:** Use CSS `:has()` to detect when `.cal-right` contains an open day panel, then override `display: none` to `display: block` with zero dimensions and `overflow: visible` — this lets the `position: fixed` child break out to fill the viewport. Supported in Safari 15.4+ (all relevant iPhones).

- [ ] **Step 1: Verify the `.dash-right` override location in `dashboard.css`**

Run:
```bash
grep -n "\.dash-right" src/app/dashboard/dashboard.css
```
Expected: three hits — the default display at ~line 1927, and two `display: none` rules at ~3060 and ~3081.

- [ ] **Step 2: Add the `:has()` override to `calendar.css`**

Find the `@media (max-width: 768px)` block at the bottom of `src/app/calendar/calendar.css` (around line 1572). Add the following CSS block **inside** that same `@media (max-width: 768px)` block, right after the closing brace of `.cal-day-details-card.is-open .cal-detail-close`:

```css
  /* ── P0 fix: un-hide the aside when the day panel is open ──────────── */
  /* dashboard.css sets .dash-right { display: none } at ≤1380px/768px.  */
  /* :has() overrides display on the parent itself — the fixed-position   */
  /* child then breaks out to fill the viewport as normal.                */
  .cal-right:has(.cal-day-details-card.is-open) {
    display: block !important;
    width: 0;
    height: 0;
    overflow: visible;
    padding: 0;
    gap: 0;
    border: none;
    box-shadow: none;
  }
  .cal-right:has(.cal-day-details-card.is-open) > :not(#day-details-card) {
    display: none;
  }
```

Also add the same override inside the `@media (max-width: 1380px)` block so it applies to tablet widths too. Find the corresponding rule for `.dash-right` suppression in dashboard.css and add a mirror rule:

In `src/app/calendar/calendar.css`, in the `@media (max-width: 960px)` block (or a new block for 1380px), add:

```css
@media (max-width: 1380px) {
  .cal-right:has(.cal-day-details-card.is-open) {
    display: block !important;
    width: 0;
    height: 0;
    overflow: visible;
    padding: 0;
    gap: 0;
    border: none;
    box-shadow: none;
  }
  .cal-right:has(.cal-day-details-card.is-open) > :not(#day-details-card) {
    display: none;
  }
}
```

- [ ] **Step 3: Verify in browser at 390px**

Start dev server if not running:
```bash
npm run dev
```

Open: `http://localhost:3001/calendar?date=2026-03-13` in a browser window resized to 390px wide.

Expected: The day panel renders fullscreen. The ✕ close button is visible. Tapping ✕ returns to the calendar grid.

- [ ] **Step 4: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: No errors (this is CSS-only).

- [ ] **Step 5: Commit**

```bash
git add src/app/calendar/calendar.css
git commit -m "fix(calendar): un-hide day panel on mobile using :has() override"
```

---

### Task 2: Fix sign-in form below the fold on iPhone

**Root cause:** `auth.module.css` keeps `.visualPane` at `min-height: 360px` on screens ≤980px and `min-height: 310px` on screens ≤640px. On a 390×844 iPhone screen, this pushes the Clerk form below the visible area.

**Files:**
- Modify: `src/app/auth.module.css`

- [ ] **Step 1: Add mobile override to `auth.module.css`**

At the bottom of `src/app/auth.module.css`, add:

```css
@media (max-width: 480px) {
  .authPage {
    padding: 12px;
    align-items: flex-start;
  }

  .authShell {
    border-radius: 16px;
  }

  /* Hide the marketing visual pane on small phones — the form must be
     visible on first load without scrolling. */
  .visualPane {
    display: none;
  }

  .formPane {
    padding: 16px 12px;
  }

  .formCard {
    padding: 16px 14px;
    border-radius: 12px;
  }

  .formCard h2 {
    font-size: 22px;
  }
}
```

- [ ] **Step 2: Verify sign-in at 390px**

Open `http://localhost:3001/sign-in` at 390px width (signed out).

Expected: The Clerk form is fully visible on first load. No scrolling required. No marketing panel visible.

- [ ] **Step 3: Verify sign-up is also improved**

Open `http://localhost:3001/sign-up` at 390px.

Expected: Same improvement — form visible immediately. (sign-up uses the same `auth.module.css`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/auth.module.css
git commit -m "fix(auth): hide visual pane on mobile so sign-in form is visible on first load"
```

---

## Chunk 2: Batch 2 — P1 Layout and Interaction Issues

### Task 3: Plans filter chips — horizontal scroll strip at ≤480px

**Root cause:** `.plans-lib-segmented` and `.plans-lib-filter-row` use `flex-wrap: wrap`, causing 3-4 rows of chips that push plan cards below the fold.

**Files:**
- Modify: `src/app/plans/plans.css`

- [ ] **Step 1: Find the existing ≤480px breakpoint in `plans.css`**

```bash
grep -n "max-width: 480px\|480px" src/app/plans/plans.css | head -10
```

- [ ] **Step 2: Add horizontal scroll override**

In `src/app/plans/plans.css`, find the `@media (max-width: 480px)` block (or add one at the bottom). Add:

```css
@media (max-width: 480px) {
  /* Plans: filter chip rows become single-line horizontal scroll strips */
  .plans-lib-segmented {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
  }
  .plans-lib-segmented::-webkit-scrollbar {
    display: none;
  }

  .plans-lib-filter-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
  }
  .plans-lib-filter-row::-webkit-scrollbar {
    display: none;
  }
}
```

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/plans` at 390px.

Expected: Filter chips are on a single scrollable row. The first plan card is visible on first load without scrolling past chip chrome.

- [ ] **Step 4: Commit**

```bash
git add src/app/plans/plans.css
git commit -m "fix(plans): filter chips scroll horizontally on mobile instead of wrapping"
```

---

### Task 4: Progress filter chips — horizontal scroll + stack CTA buttons

**Root cause:** `.prog-filter-chips` uses `flex-wrap: wrap` causing 4+ rows of plan pills. `.prog-top-actions` places two buttons side by side; the longer label truncates at 390px.

**Files:**
- Modify: `src/app/progress/progress.css`

- [ ] **Step 1: Find the ≤480px breakpoint in `progress.css`**

```bash
grep -n "480px\|max-width" src/app/progress/progress.css
```

- [ ] **Step 2: Add overrides**

In `src/app/progress/progress.css`, add a `@media (max-width: 480px)` block (or extend existing one):

```css
@media (max-width: 480px) {
  /* Stack CTA buttons vertically so labels don't truncate */
  .prog-top-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .prog-top-action-link {
    text-align: center;
  }

  /* Plan filter chips become a single horizontal scroll strip */
  .prog-filter-chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
  }
  .prog-filter-chips::-webkit-scrollbar {
    display: none;
  }
}
```

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/progress` at 390px.

Expected: Plan filter chips scroll horizontally. "Review this week adjustments" and "Go to Today" buttons stack vertically, both fully readable.

- [ ] **Step 4: Commit**

```bash
git add src/app/progress/progress.css
git commit -m "fix(progress): filter chips scroll horizontally; CTA buttons stack on mobile"
```

---

### Task 5: Dashboard — TODAY workout card first on mobile

**Root cause:** Dashboard renders plan hero (`dash-plan-summary`) before the today workout (`dash-hero`). On mobile, athletes must scroll to see what they're training today.

**Files:**
- Modify: `src/app/dashboard/dashboard.css`

**Fix strategy:** Make `.dash-center` a flex column at ≤768px and use CSS `order` to promote `.dash-hero` to appear before `.dash-plan-summary`.

- [ ] **Step 1: Find the ≤768px breakpoint in `dashboard.css`**

```bash
grep -n "max-width: 768px" src/app/dashboard/dashboard.css | head -5
```

- [ ] **Step 2: Add order overrides**

In `src/app/dashboard/dashboard.css`, inside the `@media (max-width: 768px)` block, add:

```css
  /* Promote today's workout above plan hero on mobile */
  .dash-center {
    display: flex;
    flex-direction: column;
  }
  .dash-page-heading {
    order: 0;
  }
  .dash-activation-banner {
    order: 1;
  }
  .dash-hero {
    order: 2;
  }
  .dash-plan-summary {
    order: 3;
  }
```

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/dashboard` at 390px.

Expected: Page heading → today's workout card → plan hero card (in that order). The workout title is visible on first load.

- [ ] **Step 4: Verify desktop still correct**

Open `http://localhost:3001/dashboard` at 1200px.

Expected: Original order preserved — page heading → plan hero → today card.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/dashboard.css
git commit -m "fix(dashboard): promote today's workout above plan hero on mobile via CSS order"
```

---

### Task 6: Calendar grid — enable horizontal scroll at ≤480px

**Root cause:** At `max-width: 640px`, calendar sets `min-width: 560px` on `.cal-weekdays` and `.cal-grid`, but the containing `.cal-month-card` has no `overflow-x: auto`, so cells compress below their minimum instead of enabling scroll.

**Files:**
- Modify: `src/app/calendar/calendar.css`

- [ ] **Step 1: Find `.cal-month-card` and `.cal-month-scroll` in `calendar.css`**

```bash
grep -n "cal-month-card\|cal-month-scroll" src/app/calendar/calendar.css | head -10
```

- [ ] **Step 2: Add overflow-x to the scroll wrapper**

Find `.cal-month-scroll` rule (around line 284) in `calendar.css`. It already has `overflow-x: auto`. Confirm it wraps the grid. If the wrapper is `.cal-month-card`, add `overflow-x: auto` there.

Add inside the `@media (max-width: 640px)` block:

```css
  .cal-month-card {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
```

- [ ] **Step 3: Reduce cell minimum content at ≤480px**

In `calendar.css`, add to the `@media (max-width: 480px)` block (or create one):

```css
@media (max-width: 480px) {
  /* Tighten cell minimum to avoid excessive horizontal scroll distance */
  .cal-weekdays,
  .cal-grid {
    min-width: 420px;
    grid-template-columns: repeat(7, minmax(58px, 1fr));
  }

  /* Hide distance/pace labels in cells — only show type badge + dot */
  .cal-act-dist,
  .cal-act-pace {
    display: none;
  }
}
```

- [ ] **Step 4: Verify at 390px**

Open `http://localhost:3001/calendar` at 390px.

Expected: Calendar grid scrolls horizontally. Cells show activity type badge and completion dot but not distance/pace clutter. Adjacent cells are no longer mis-tappable.

- [ ] **Step 5: Commit**

```bash
git add src/app/calendar/calendar.css
git commit -m "fix(calendar): enable horizontal scroll on mobile; reduce cell content density"
```

---

### Task 7: Coach button — compact FAB instead of full-width strip

**Root cause:** `.ai-widget-pill` at `max-width: 768px` is `width: 100%` — a full-width strip above the bottom nav that covers the last row of plan day entries.

**Files:**
- Modify: `src/app/plans/plans.css`

- [ ] **Step 1: Find the mobile `.ai-widget-pill` rule**

```bash
grep -n "ai-widget-pill\|ai-widget--mobile" src/app/plans/plans.css | head -10
```

Expected: Rule around line 4872 inside `@media (max-width: 768px)`.

- [ ] **Step 2: Replace full-width with compact FAB**

Find the `@media (max-width: 768px)` block and the `.ai-widget-pill` rule inside it. Replace:

```css
/* BEFORE */
  .ai-widget-pill {
    width: 100%;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  }
```

With:

```css
/* AFTER */
  .ai-widget-pill {
    width: auto;
    align-self: flex-end;
    padding: 0 20px;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
    min-width: 140px;
  }
```

Also ensure `.ai-widget--mobile.is-closed` positions to the right side. Find that rule and update:

```css
  .ai-widget--mobile.is-closed {
    position: fixed;
    right: 16px;
    left: auto;  /* override the left: 12px */
    bottom: calc(12px + 56px + env(safe-area-inset-bottom));
    display: flex;
    justify-content: flex-end;
  }
```

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/plans/<any-plan-id>` at 390px.

Expected: Coach trigger is a compact pill/FAB in the bottom-right corner. The plan day grid rows are no longer obscured by a full-width button.

- [ ] **Step 4: Commit**

```bash
git add src/app/plans/plans.css
git commit -m "fix(plans): compact AI coach button to FAB on mobile; no longer full-width"
```

---

### Task 8: Strava import — reduce helper text on mobile

**Root cause:** Import row action text ("Open in Calendar to Reopen Day") wraps and overflows in compact card layout at 390px.

**Files:**
- Modify: `src/app/strava/strava.css`

- [ ] **Step 1: Find import row text classes**

```bash
grep -n "import.*text\|action.*text\|helper\|link.*text\|reopen\|calendar.*link" src/app/strava/strava.css | head -10
```

- [ ] **Step 2: Add font-size reduction at ≤480px**

In `src/app/strava/strava.css`, find or add a `@media (max-width: 480px)` block and add:

```css
@media (max-width: 480px) {
  /* Reduce import row helper text to prevent overflow */
  .strava-import-action,
  .strava-import-link,
  .strava-import-note,
  .strava-row-action {
    font-size: 11px;
    line-height: 1.4;
  }
}
```

(Use actual class names found in step 1 — adjust selectors to match.)

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/strava` at 390px (with Strava connected and imports present).

Expected: Import row action text is fully readable. No overflow.

- [ ] **Step 4: Commit**

```bash
git add src/app/strava/strava.css
git commit -m "fix(strava): reduce import helper text size on mobile to prevent overflow"
```

---

## Chunk 3: Batch 3 — P2 Polish

### Task 9: MobileNav — auth gate + dark mode token fix

**Root cause (auth gate):** `MobileNav` renders on `/` and `/sign-in` because `layout.tsx` includes it unconditionally. All five tabs require auth — new visitors see confusing navigation.

**Root cause (dark mode):** `MobileNav.module.css` hardcodes `background: #fff` and `border-top: 1px solid #e5e5e5`. No dark mode override.

**Files:**
- Modify: `src/components/MobileNav.tsx`
- Modify: `src/components/MobileNav.module.css`

- [ ] **Step 1: Add auth and route gate to `MobileNav.tsx`**

`MobileNav.tsx` already imports `usePathname`. Add `useAuth` from `@clerk/nextjs`:

```tsx
import { useAuth } from '@clerk/nextjs';
```

At the top of the component function, add:

```tsx
const { isSignedIn } = useAuth();
```

Add a list of public routes to suppress on, and return null early:

```tsx
const PUBLIC_ROUTES = ['/', '/sign-in', '/sign-up', '/auth/resolve-role', '/select-role'];
const isPublicRoute = PUBLIC_ROUTES.some(
  (r) => pathname === r || pathname.startsWith(r + '/')
);

if (!isSignedIn || isPublicRoute) return null;
```

Place this block **after** all hook calls (hooks cannot be conditionally called).

- [ ] **Step 2: Fix dark mode tokens in `MobileNav.module.css`**

In `src/components/MobileNav.module.css`, change:

```css
/* BEFORE */
    background: #fff;
    border-top: 1px solid #e5e5e5;
```

To:

```css
/* AFTER */
    background: var(--d-raised, #fff);
    border-top: 1px solid var(--d-border, #e5e5e5);
```

- [ ] **Step 3: Verify auth gate**

Open `http://localhost:3001/` at 390px (signed out).

Expected: No bottom tab bar visible.

Open `http://localhost:3001/sign-in` at 390px.

Expected: No bottom tab bar visible.

Open `http://localhost:3001/dashboard` at 390px (signed in).

Expected: Bottom tab bar visible and functional.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/MobileNav.tsx src/components/MobileNav.module.css
git commit -m "fix(nav): hide MobileNav on public routes; use design tokens for dark mode"
```

---

### Task 10: Profile — destructive Disconnect button styling

**Root cause:** Strava "Disconnect" button has identical visual weight as "Sync now". Easy accidental tap.

**Files:**
- Modify: `src/app/profile/profile.css`

- [ ] **Step 1: Identify the disconnect button class/selector**

```bash
grep -n "disconnect\|Disconnect" src/app/profile/page.tsx | head -10
```

Find the className or element used for the Disconnect button.

- [ ] **Step 2: Add destructive styling**

In `src/app/profile/profile.css`, find `.profile-strava-actions` and add a rule for the disconnect button. If the button uses a generic class, target it by attribute or add a specific class in the TSX if needed.

Add to `profile.css`:

```css
/* Destructive action: visually distinguish Disconnect from safe actions */
.profile-strava-actions .profile-btn--destructive,
.profile-strava-actions [data-action="disconnect"] {
  color: #b42318;
  border-color: rgba(180, 35, 24, 0.4);
  background: rgba(180, 35, 24, 0.05);
}

.profile-strava-actions .profile-btn--destructive:hover,
.profile-strava-actions [data-action="disconnect"]:hover {
  background: rgba(180, 35, 24, 0.1);
  border-color: #b42318;
}
```

If no suitable class/attribute exists on the button, add `data-action="disconnect"` to the button in `src/app/profile/page.tsx`.

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/profile` at 390px (Strava connected).

Expected: "Disconnect" button has red text/border, visually distinct from "Sync now".

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/profile.css src/app/profile/page.tsx
git commit -m "fix(profile): destructive Disconnect button gets red styling"
```

---

### Task 11: Calendar — month nav minimum tap target

**Root cause:** Month prev/next buttons are ~55×32px, below the 44×44px iOS HIG minimum.

**Files:**
- Modify: `src/app/calendar/calendar.css`

- [ ] **Step 1: Find the month nav button class**

```bash
grep -n "cal-month-btn\|cal-prev\|cal-next\|month-nav" src/app/calendar/calendar.css | head -10
```

- [ ] **Step 2: Add minimum tap target**

Find `.cal-month-btn` (or equivalent) in `calendar.css` and add:

```css
.cal-month-btn {
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
}
```

(If the rule already exists, add the min-height/min-width to it rather than creating a duplicate.)

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/calendar` at 390px.

Expected: Prev/Next buttons have sufficient tap target height. Easy to tap with a thumb.

- [ ] **Step 4: Commit**

```bash
git add src/app/calendar/calendar.css
git commit -m "fix(calendar): month nav buttons meet 44px minimum tap target"
```

---

### Task 12: Upload — remove redundant date format placeholder

**Root cause:** Date input has `placeholder="dd.mm.yyyy"` but uses `type="date"` which renders the native iOS picker — the placeholder never appears during native interaction.

**Files:**
- Modify: `src/app/upload/page.tsx` (or the upload form component)

- [ ] **Step 1: Find the date input**

```bash
grep -n "placeholder.*dd\|type.*date\|dd.mm.yyyy" src/app/upload/page.tsx
```

- [ ] **Step 2: Remove the placeholder attribute**

Remove `placeholder="dd.mm.yyyy"` (or equivalent) from the date input element. The native picker provides its own format guidance.

- [ ] **Step 3: Verify at 390px**

Open `http://localhost:3001/upload` at 390px.

Expected: Date input shows native iOS date picker without redundant placeholder.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/upload/page.tsx
git commit -m "fix(upload): remove redundant date format placeholder on native date input"
```

---

### Task 13: Landing — investigate and fix duplicate navigation

**Root cause:** Audit found two nav bars stacked on the landing page at 390px. This task confirms whether it's a global header + landing nav duplication, and fixes it.

**Files:**
- Read: `src/app/page.tsx`
- Read: `src/app/layout.tsx`
- Possibly modify: `src/app/page.module.css` or `src/app/layout.tsx`

- [ ] **Step 1: Inspect the landing page structure**

```bash
grep -n "nav\|header\|Nav\|Header\|MobileNav\|sign-in\|sign-up" src/app/page.tsx | head -30
```

```bash
grep -n "nav\|header\|Nav\|Header\|MobileNav" src/app/layout.tsx | head -20
```

- [ ] **Step 2: Determine the duplication source**

If the landing page renders its own nav with the same links as the global layout header, either:
- Option A: Hide the global header on the landing route
- Option B: Remove the duplicate nav from `page.tsx`

Choose the option with smallest blast radius (prefer removing from `page.tsx` if the landing nav is self-contained there).

- [ ] **Step 3: Apply the fix**

If the global `<header>` in `layout.tsx` renders on all routes including `/`:

In `layout.tsx`, conditionally suppress on `/`:
```tsx
// Add at top of layout component:
const hideGlobalHeader = pathname === '/';
// Then in JSX:
{!hideGlobalHeader && <header>...</header>}
```

Or in CSS, if the landing page has a unique body class or data attribute:
```css
.landing-page header { display: none; }
```

- [ ] **Step 4: Verify at 390px**

Open `http://localhost:3001/` at 390px (signed out).

Expected: Single navigation bar. No duplication. Primary CTA visible above the fold.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/layout.tsx
git commit -m "fix(landing): remove duplicate navigation bar on mobile"
```

---

## Verification Pass

After all tasks are complete:

- [ ] **Run full typecheck**

```bash
npm run typecheck
```
Expected: Zero errors.

- [ ] **Run lint**

```bash
npm run lint
```
Expected: Zero new warnings.

- [ ] **Screenshot verification at 390px — key routes**

Open each route at 390px and confirm top-level fix:

| Route | Expected |
|-------|----------|
| `/sign-in` | Form visible on first load, no marketing panel |
| `/` | Single nav bar, CTA visible |
| `/dashboard` | TODAY card first, plan hero below it |
| `/plans` | Filter chips on one scrollable row |
| `/calendar` | Day panel opens fullscreen on day tap |
| `/calendar` | Grid scrolls horizontally; cells readable |
| `/progress` | Filter chips scroll; CTA buttons stacked |
| `/profile` | Disconnect button is red-styled |
| `/plans/[id]` | Coach button is compact FAB bottom-right |
| `/strava` | Import helper text readable |

- [ ] **Update findings doc with resolution notes**

In `docs/plans/2026-03-13-athlete-iphone-audit-findings.md`, add a `## Resolved` section listing each issue and its fix commit.

- [ ] **Final commit**

```bash
git add docs/plans/2026-03-13-athlete-iphone-audit-findings.md
git commit -m "docs: mark iPhone audit findings as resolved"
```
