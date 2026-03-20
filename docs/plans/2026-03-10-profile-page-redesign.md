# Profile Page Redesign — Design Document

> **Status: COMPLETED** — implemented and merged to main

**Date:** 2026-03-10
**Status:** Approved — ready for implementation
**Scope:** Athlete profile page only (`/profile`)

---

## Problem

The current profile page is settings-first. It functions as a configuration form (pace zones, units, Strava) with no sense of athlete identity. Several useful data points are already stored in the database but never surfaced: email, member-since date, training stats, race goal details (distance + target time from `paceTargets.raceGoal`), and Strava connection age. The page doesn't reflect who the athlete is — only what they've configured.

---

## Goal

A profile page that serves two jobs in one view:
1. **Identity** — athlete sees who they are, their progress, their race goal
2. **Settings** — configure units, pace zones, coach link, integrations

---

## Layout

Two-column layout on desktop, single-column stack on mobile (≤768px). Uses existing `dash-card`, `dash-grid`, and CSS token system.

```
┌───────────────────────┬─────────────────────────────┐
│  LEFT (identity)      │  RIGHT (settings)           │
│                       │                             │
│  Avatar Card          │  Personal (name, units)     │
│  Race Goal Card       │  Pace Zones (calculator)    │
│  Training Stats Card  │  Coach (dropdown)           │
│  Strava Card          │                             │
└───────────────────────┴─────────────────────────────┘
```

---

## Components

### 1. Avatar Card
- Circle avatar with first initial, `--d-orange` background
- Full name (display only — editable in right column)
- Email (read-only, `mailto:` link)
- "Member since [Month YYYY]" from `user.createdAt`
- Role badge: `Athlete` or `Athlete · Coach` if `hasBothRoles`

### 2. Race Goal Card
**If race goal is set:**
- Countdown chip: "42 days" — orange at ≤14 days, "Race week!" at ≤7, "Past" after race date
- Race label: Marathon / Half Marathon / 10K / 5K / Custom (derived from `raceDistanceKm`)
- Target finish time formatted as "3:45:00" from `goalTimeSec`
- Target pace computed: `goalTimeSec / raceDistanceKm`, converted to viewer units
- Edit icon → smooth-scrolls to Pace Zones section (right column)

**If not set:**
- Muted "No race goal set" + "Set one →" link scrolling to pace zones

**Data source:** `user.goalRaceDate` + `user.paceTargets.raceGoal` (already stored, not yet surfaced)

### 3. Training Stats Card
- Three read-only stat rows: Total plans · Completed sessions · Active weeks
- Loaded async with skeleton placeholder (does not block page)
- "Active weeks" = distinct weeks with ≥1 completed PlanActivity
- Tooltip on active weeks: "Weeks with at least one completed session"

### 4. Strava Card
- Existing: connected badge, username, last sync, connect/sync/disconnect buttons
- New: "Connected since [date]" from `ExternalAccount.connectedAt`
- Garmin row: "Coming soon" (replace current error/501 state)

### 5. Personal Section (right)
- Name field — saves on blur
- Units toggle (MILES / KM) — saves immediately on toggle

### 6. Pace Zones Section (right)
- Existing calculator UX preserved
- Restyled to fit column width
- Race goal changes here update the Race Goal Card on the left in real time

### 7. Coach Section (right)
- Existing dropdown, unchanged behaviour
- Only shown when `currentRole === 'ATHLETE'`

---

## Data & API

### Existing endpoints (unchanged)
| Endpoint | Used for |
|----------|---------|
| `GET /api/me` | name, email, createdAt, role, hasBothRoles, units, paceTargets, goalRaceDate |
| `PUT /api/me` | save name, units, paceTargets, goalRaceDate |
| `GET /api/integrations/accounts` | Strava connection status |
| `GET /api/coaches` | Coach dropdown options |
| `POST /api/coach-link` | Link to coach |

### New endpoint
**`GET /api/me/stats`**
```ts
// Response
{
  totalPlans: number        // TrainingPlan.count where athleteId = userId, isTemplate = false
  completedSessions: number // PlanActivity.count where plan.athleteId = userId, completed = true
  activeWeeks: number       // PlanWeek count where ≥1 completed PlanActivity in that week
  memberSince: string       // user.createdAt — ISO string (formatted client-side)
}
```
Fetched async after page load; skeleton shown while loading.

---

## Save Behaviour

Each section saves independently — no global "Save all" button.

| Section | Save trigger | Feedback |
|---------|-------------|---------|
| Name | On blur | Inline green tick |
| Units | On toggle | Immediate, no feedback needed |
| Pace zones | Existing save button | Existing behaviour |
| Coach | On select | Existing behaviour |

No page redirect on save. Errors shown inline below the relevant field.

---

## Mobile

At ≤768px: left column stacks above right column. Card order:
1. Avatar Card
2. Race Goal Card
3. Training Stats Card
4. Personal Settings
5. Pace Zones
6. Coach
7. Strava Card

---

## What's Not Changing

- Pace zones calculator logic and API — preserved exactly
- Strava connect/disconnect/sync flow — preserved exactly
- Coach link API — preserved exactly
- No schema changes required

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/app/profile/page.tsx` | Rewrite — new layout |
| `src/app/profile/profile.css` | Create — new styles |
| `src/app/api/me/stats/route.ts` | Create — new stats endpoint |
