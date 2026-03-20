# Athlete Beta Polish Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the athlete onboarding and execution flow so shared beta users can get from sign-in to day-card entry, Strava sync, and workout logging with less hesitation.

**Architecture:** Keep the existing dashboard, calendar, and Strava surfaces, but tighten the experience with clearer entry copy, direct links into the day card, and a safer Strava sync action model. The work should stay local to the athlete-facing UI and reuse the existing dashboard token system and button patterns.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS modules/shared route CSS, Node `node:test`

---

### Task 1: Lock the new athlete-flow copy and routing helpers with a failing test

**Files:**
- Create: `src/lib/athlete-flow-ui.ts`
- Create: `scripts/athlete-flow-ui.test.ts`

**Step 1: Write the failing test**

Cover:
- `getDayLogEntryCopy('OPEN' | 'PARTIAL' | 'DONE' | 'MISSED')` returns the intended button label and helper copy
- `buildCalendarDayDetailsHref(dateISO, planId)` preserves the plan id, selected date, and `#day-details-card` anchor
- `getStravaPanelActions(connected)` returns `connect` when disconnected and `sync + disconnect` when connected

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types scripts/athlete-flow-ui.test.ts
```

Expected:
- FAIL because the helper module does not exist yet

### Task 2: Add the shared helper and use it for dashboard/day-card entry polish

**Files:**
- Create: `src/lib/athlete-flow-ui.ts`
- Modify: `src/components/DashboardDayLogShell.tsx`
- Modify: `src/app/dashboard/dashboard.css`

**Step 1: Write minimal implementation**

Add:
- a pure helper for day-log entry copy
- a shared day-card href builder for dashboard -> calendar day details

Use it in `DashboardDayLogShell` to:
- improve collapsed-state copy
- add a direct “open in calendar” entry
- use a clearer open-panel label

**Step 2: Run the focused test**

Run:

```bash
node --test --experimental-strip-types scripts/athlete-flow-ui.test.ts
```

Expected:
- PASS

### Task 3: Polish Strava sync guidance and safer actions

**Files:**
- Modify: `src/components/StravaSyncPanel.tsx`
- Modify: `src/components/StravaDaySyncButton.tsx`
- Modify: `src/app/strava/page.tsx`
- Modify: `src/app/strava/strava.css`
- Modify: `src/app/dashboard/dashboard.css`

**Step 1: Update the Strava flow**

Make the sync UI:
- clearer about the next action
- less noisy by removing the always-visible reconnect button
- safer by styling disconnect as destructive/quiet
- more explicit for day-level import wording

Add direct shortcuts on the Strava page into today/dashboard/calendar where useful.

**Step 2: Keep styling within existing dashboard tokens**

Use local CSS additions only:
- action emphasis
- destructive button treatment
- helper text spacing/mobile behavior

### Task 4: Tighten onboarding CTA clarity in dashboard empty states

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Step 1: Refine empty-state action hierarchy**

Make the first-run dashboard states more direct:
- route athletes to `/upload` when they have no plans
- keep review/activation actions explicit when a draft exists
- reduce management-language in CTA copy

### Task 5: Final verification

**Files:**
- No required new files

**Step 1: Run checks**

Run:

```bash
node --test --experimental-strip-types scripts/athlete-flow-ui.test.ts
npm run lint
npm run typecheck
```

**Step 2: Manual spot-check**

Verify:
- dashboard collapsed log entry shows the new copy and calendar shortcut
- Strava panel only shows the expected actions
- day-level Strava import wording feels clearer
- dashboard empty states point to the right next step
