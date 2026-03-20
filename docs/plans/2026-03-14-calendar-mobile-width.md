# Calendar Mobile Width Implementation Plan

> **Status: COMPLETED** — implemented and merged to main

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the iPhone calendar grid feel less cramped by keeping the horizontally scrollable month view wider at the smallest breakpoint.

**Architecture:** This is a local CSS adjustment in the mobile calendar breakpoint. Keep horizontal scroll, widen the grid minimum width, and enlarge the minimum per-day column size so the athlete gets more breathing room without changing the calendar structure.

**Tech Stack:** Next.js App Router, shared route CSS, Node `node:test`

---

### Task 1: Lock the iPhone calendar width target with a failing test

**Files:**
- Create: `scripts/calendar-mobile-width.test.ts`
- Modify: `src/app/calendar/calendar.css`

**Step 1: Write the failing test**

Assert that the `@media (max-width: 480px)` block in `src/app/calendar/calendar.css` uses:
- `min-width: 532px`
- `grid-template-columns: repeat(7, minmax(72px, 1fr))`

**Step 2: Run test to verify it fails**

Run:

```bash
node --test scripts/calendar-mobile-width.test.ts
```

Expected:
- FAIL because the file still uses the narrower `420px` / `58px` rule

### Task 2: Implement the minimal CSS change

**Files:**
- Modify: `src/app/calendar/calendar.css`

**Step 1: Update the smallest breakpoint**

Keep the existing horizontal scroll behavior on `.cal-month-card`, but widen the grid at `<=480px` so day columns do not feel overly compressed.

**Step 2: Re-run the test**

Run:

```bash
node --test scripts/calendar-mobile-width.test.ts
```

Expected:
- PASS

### Task 3: Final verification

**Files:**
- No additional files

**Step 1: Run checks**

Run:

```bash
node --test scripts/calendar-mobile-width.test.ts
npm run lint
npm run typecheck
```
