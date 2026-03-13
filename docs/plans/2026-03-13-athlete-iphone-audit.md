# Athlete iPhone UX Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Audit the athlete-facing CoachPlan experience on iPhone Safari and produce a prioritized backlog of UI/UX issues that block or degrade core athlete tasks.

**Architecture:** This is an audit-and-triage plan, not a redesign. The work is organized by athlete journeys and screen states, with every finding tied to a route, viewport, severity, screenshot, and recommended fix so follow-up implementation can be batched safely.

**Tech Stack:** Next.js app router, React, Clerk auth, shared CSS modules/global route CSS, Safari mobile viewport testing, Playwright/manual mobile QA, markdown documentation in `docs/plans/`

---

## Audit Principles

- Athlete-only scope for phase 1
- Safari-first on iPhone 13 Pro (`390x844`) and iPhone 14 Pro (`393x852`)
- Review by journey, not just by route
- Evaluate default, loading, empty, error, long-content, keyboard-open, and confirmation states where relevant
- Log defects as `P0`, `P1`, or `P2`
- Prefer evidence over intuition: screenshot or video for every issue
- Do not start fixing while auditing; capture patterns first, then batch remediation

## Severity Rubric

- `P0`: athlete cannot complete a core mobile task
- `P1`: athlete can complete the task, but the UI is confusing, fragile, visually broken, or error-prone
- `P2`: issue is non-blocking polish, consistency, hierarchy, readability, or ergonomic debt

## Output Artifacts

- Primary audit plan: `docs/plans/2026-03-13-athlete-iphone-audit.md`
- Findings log: `docs/plans/2026-03-13-athlete-iphone-audit-findings.md`
- Screenshot folder: `artifacts/iphone-audit/`

## Athlete Scope

### In scope routes

- `/`
- `/sign-in/[[...sign-in]]`
- `/sign-up/[[...sign-up]]`
- `/auth/resolve-role`
- `/select-role`
- `/dashboard`
- `/plans`
- `/plans/[id]`
- `/plans/[id]/review`
- `/calendar`
- `/progress`
- `/profile`
- `/upload`
- `/strava`

### In scope supporting interactions

- AI trainer on plan detail
- selected-day panel and workout completion flows
- activity logging and actuals entry
- sync and import-related athlete surfaces
- error boundaries on athlete routes

### Out of scope for phase 1

- `/coach`
- `/admin`
- `/design`
- parser debug and internal tooling

## Route-to-File Map

- Landing and auth
  - `src/app/page.tsx`
  - `src/app/page.module.css`
  - `src/app/sign-in/[[...sign-in]]/page.tsx`
  - `src/app/sign-up/[[...sign-up]]/page.tsx`
  - `src/app/auth/resolve-role/page.tsx`
  - `src/app/select-role/page.tsx`
  - `src/app/select-role/select-role.css`
  - `src/app/auth.module.css`

- Dashboard and navigation
  - `src/app/dashboard/page.tsx`
  - `src/app/dashboard/dashboard.css`
  - `src/app/dashboard/error.tsx`
  - `src/app/globals.css`
  - `src/app/athlete-pages.css`

- Plans
  - `src/app/plans/page.tsx`
  - `src/app/plans/PlansClient.tsx`
  - `src/app/plans/plans.css`
  - `src/app/plans/[id]/page.tsx`
  - `src/app/plans/[id]/review/page.tsx`
  - `src/app/plans/[id]/review/review.css`
  - `src/app/plans/[id]/error.tsx`
  - `src/app/plans/error.tsx`

- Calendar and day actions
  - `src/app/calendar/page.tsx`
  - `src/app/calendar/calendar.css`
  - `src/app/calendar/error.tsx`

- Progress and profile
  - `src/app/progress/page.tsx`
  - `src/app/progress/progress.css`
  - `src/app/profile/page.tsx`
  - `src/app/profile/profile.css`

- Upload and integrations
  - `src/app/upload/page.tsx`
  - `src/app/guide/page.tsx`
  - `src/app/guide/guide.css`
  - `src/app/strava/page.tsx`
  - `src/app/strava/strava.css`
  - `src/app/strava/error.tsx`

## Device Matrix

- Device A: iPhone 13 Pro viewport `390x844`
- Device B: iPhone 14 Pro viewport `393x852`
- Browser: Mobile Safari
- Chrome states:
  - browser chrome expanded
  - browser chrome collapsed after scroll
- Orientation:
  - portrait required
  - landscape only for calendar and plan-review sanity checks

## Audit Checklist

For every high-priority screen, review:

- Can the athlete tell where they are immediately?
- Is the primary action obvious without scrolling or guessing?
- Are controls reachable and tappable with one hand?
- Do safe areas protect content from the notch, home indicator, and Safari bottom chrome?
- Does keyboard opening preserve the active input and its submit action?
- Are loading, empty, error, and success states understandable?
- Does any modal, drawer, or sheet trap scroll or hide dismissal controls?
- Is important content readable at normal text size without zooming?
- Are destructive actions separated, confirmed, and hard to mis-tap?
- Does the screen recover cleanly from network failure or stale data?

## Task 1: Set Up Audit Workspace

**Files:**
- Review: `docs/plans/2026-03-13-athlete-iphone-audit.md`
- Create: `docs/plans/2026-03-13-athlete-iphone-audit-findings.md`
- Create: `artifacts/iphone-audit/`

**Step 1: Create the findings document**

Add sections for:
- summary
- recurring patterns
- `P0` findings
- `P1` findings
- `P2` findings
- recommended fix batches

**Step 2: Create the screenshot output folder**

Run:

```bash
mkdir -p artifacts/iphone-audit
```

Expected: folder exists for screenshots and recordings.

**Step 3: Start the app locally**

Run:

```bash
npm run dev
```

Expected: local app available on `http://localhost:3001`.

**Step 4: Confirm baseline athlete access**

Verify:
- athlete login works
- a representative athlete account has at least one plan
- calendar, progress, and Strava surfaces have usable data

**Step 5: Commit planning-only artifacts if desired**

```bash
git add docs/plans/2026-03-13-athlete-iphone-audit.md docs/plans/2026-03-13-athlete-iphone-audit-findings.md
git commit -m "docs: add athlete iPhone audit plan"
```

## Task 2: Audit Entry, Auth, and First-Run Orientation

**Files:**
- Review: `src/app/page.tsx`
- Review: `src/app/page.module.css`
- Review: `src/app/sign-in/[[...sign-in]]/page.tsx`
- Review: `src/app/sign-up/[[...sign-up]]/page.tsx`
- Review: `src/app/auth/resolve-role/page.tsx`
- Review: `src/app/select-role/page.tsx`
- Review: `src/app/select-role/select-role.css`

**Step 1: Review the unauthenticated entry flow**

Check:
- landing page hierarchy
- CTA visibility above the fold
- mobile readability
- role confusion

**Step 2: Review sign-in and sign-up on iPhone**

Check:
- keyboard overlap
- input focus visibility
- Clerk form spacing
- legal/copy overflow
- autofill friendliness

**Step 3: Review role resolution and selection**

Check:
- redirect clarity
- waiting/loading states
- button reachability
- accidental dead ends

**Step 4: Record findings in the findings file**

Use this template:

```md
### [Severity] [Route] [Short title]
- Device:
- State:
- Problem:
- User impact:
- Evidence:
- Recommendation:
```

## Task 3: Audit Dashboard and Athlete Navigation

**Files:**
- Review: `src/app/dashboard/page.tsx`
- Review: `src/app/dashboard/dashboard.css`
- Review: `src/app/dashboard/error.tsx`
- Review: `src/app/globals.css`
- Review: `src/app/athlete-pages.css`

**Step 1: Review dashboard first paint**

Check:
- visual hierarchy
- “today” comprehension
- chart/card stacking
- spacing density

**Step 2: Review navigation patterns**

Check:
- top navigation clarity
- back behavior
- persistent controls
- cross-page consistency

**Step 3: Review error and empty states**

Check:
- whether empty dashboard tells athlete what to do next
- whether error recovery is actionable

**Step 4: Capture recurring patterns**

Add a “recurring patterns” section for issues like:
- cramped cards
- tiny secondary actions
- missing safe-area padding
- overlong copy blocks

## Task 4: Audit Plans List and Plan Detail

**Files:**
- Review: `src/app/plans/page.tsx`
- Review: `src/app/plans/PlansClient.tsx`
- Review: `src/app/plans/plans.css`
- Review: `src/app/plans/[id]/page.tsx`
- Review: `src/app/plans/[id]/error.tsx`

**Step 1: Review plans list**

Check:
- scanability of plan cards
- active vs archived understanding
- tap target size
- mobile filtering/sorting behavior if present

**Step 2: Review plan detail default state**

Check:
- weekly layout comprehension
- header density
- selected activity patterns
- sticky controls
- source metadata readability

**Step 3: Review plan detail interactions**

Check:
- open/close selected-day flow
- activity tap behavior
- drag/edit mode safeguards on iPhone
- AI trainer entry and close behavior

**Step 4: Review long-content and keyboard states**

Check:
- long week names or notes
- multiple activities in one day
- AI coach keyboard open
- footer overlap

**Step 5: Log blockers separately**

Any issue affecting basic plan reading or workout completion should be raised to `P0` or `P1` immediately.

## Task 5: Audit Plan Review Flow

**Files:**
- Review: `src/app/plans/[id]/review/page.tsx`
- Review: `src/app/plans/[id]/review/review.css`

**Step 1: Review review-page information hierarchy**

Check:
- parse confidence clarity
- unresolved issue visibility
- publish CTA visibility
- row/card readability on narrow screens

**Step 2: Review interactive review actions**

Check:
- edit day
- edit activity
- reparse controls
- confirmation and error handling

**Step 3: Review modal and drawer behavior**

Check:
- scroll lock
- close affordance
- keyboard handling
- stacked overlays

## Task 6: Audit Calendar and Daily Logging

**Files:**
- Review: `src/app/calendar/page.tsx`
- Review: `src/app/calendar/calendar.css`
- Review: `src/app/calendar/error.tsx`

**Step 1: Review month/week/day comprehension**

Check:
- can athlete find today quickly
- can athlete understand status colors and icons
- does the day panel feel native on iPhone

**Step 2: Review selected-day panel**

Check:
- open/close model
- safe-area padding
- visible primary action
- vertical rhythm in dense days

**Step 3: Review workout completion**

Check:
- completion CTA visibility
- actuals entry
- validation messages
- success confirmation
- accidental dismissal

**Step 4: Review error recovery**

Check:
- sync/import failures
- save failures
- stale state after completion

## Task 7: Audit Progress and Profile

**Files:**
- Review: `src/app/progress/page.tsx`
- Review: `src/app/progress/progress.css`
- Review: `src/app/profile/page.tsx`
- Review: `src/app/profile/profile.css`

**Step 1: Review progress readability**

Check:
- chart overflow
- metric card stacking
- trend comprehension
- copy density on mobile

**Step 2: Review profile forms and settings**

Check:
- form labels
- input spacing
- save confirmation
- destructive or account-level controls

**Step 3: Review performance snapshot and stats states**

Check:
- empty state usefulness
- stale data trust
- mobile scanning

## Task 8: Audit Upload, Guide, and Strava Surfaces

**Files:**
- Review: `src/app/upload/page.tsx`
- Review: `src/app/guide/page.tsx`
- Review: `src/app/guide/guide.css`
- Review: `src/app/strava/page.tsx`
- Review: `src/app/strava/strava.css`
- Review: `src/app/strava/error.tsx`

**Step 1: Review upload flow**

Check:
- file picker accessibility on iPhone
- upload status clarity
- parse start/wait states
- post-upload orientation

**Step 2: Review guide/help surfaces**

Check:
- readability
- in-context usefulness
- whether long copy is chunked for mobile

**Step 3: Review Strava integration flow**

Check:
- connect CTA clarity
- status visibility
- sync action affordance
- error and retry messaging
- conflict comprehension for athletes

## Task 9: Consolidate Findings Into Fix Batches

**Files:**
- Modify: `docs/plans/2026-03-13-athlete-iphone-audit-findings.md`

**Step 1: Group findings by pattern**

Use buckets like:
- safe area and bottom chrome collisions
- keyboard and input visibility
- touch target and control density
- modal/sheet scroll lock
- hierarchy/readability
- stale or low-trust state presentation

**Step 2: Group findings by fix batch**

- Batch 1: `P0` and high-confidence `P1` blockers
- Batch 2: repeated interaction and layout issues across plan/calendar/dashboard
- Batch 3: polish and consistency improvements

**Step 3: Add recommended metrics**

Track:
- time to open today’s workout
- workout completion success rate on mobile
- AI coach open-to-apply success rate on mobile
- mobile sync failure rate
- count of open `P0/P1` iPhone issues

## Task 10: Prepare Handoff for Remediation

**Files:**
- Modify: `docs/plans/2026-03-13-athlete-iphone-audit-findings.md`

**Step 1: Add a remediation summary**

Include:
- top 5 blockers
- top 5 repeated patterns
- recommended first remediation PR scope

**Step 2: Identify likely implementation files**

List recurring hotspots such as:
- `src/app/globals.css`
- `src/app/athlete-pages.css`
- `src/app/dashboard/dashboard.css`
- `src/app/plans/plans.css`
- `src/app/calendar/calendar.css`
- `src/app/progress/progress.css`
- `src/app/profile/profile.css`
- `src/app/strava/strava.css`

**Step 3: Define success for phase 1**

Phase 1 is complete when:
- every in-scope athlete route was reviewed on both target iPhone viewports
- every `P0` and `P1` issue has evidence and a recommended fix
- recurring patterns are grouped into remediation batches
- the team can start implementation without rediscovering the audit

## Findings Template Appendix

```md
# Athlete iPhone Audit Findings

## Summary
- Screens audited:
- `P0` count:
- `P1` count:
- `P2` count:

## Recurring Patterns
- Pattern:
  - Routes:
  - Impact:
  - Likely fix area:

## Findings

### [P0] `/calendar` selected-day panel hides primary action behind Safari chrome
- Device: iPhone 13 Pro (`390x844`)
- State: keyboard open
- Problem: the complete-workout CTA falls below the visible viewport when the keyboard opens
- User impact: athlete cannot reliably finish workout logging
- Evidence: `artifacts/iphone-audit/calendar-selected-day-keyboard.png`
- Recommendation: make the panel keyboard-aware and preserve CTA visibility above safe area
```

## Notes

- Do not fix as you discover issues unless a blocker prevents continuing the audit
- If a route is broken due to an existing unrelated bug, log it and continue the rest of the journey
- Prefer one source of truth for findings to avoid duplicate bug lists in chat, screenshots, and ad hoc notes
