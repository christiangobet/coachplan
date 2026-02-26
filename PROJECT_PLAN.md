# CoachPlan — Developer Onboarding & Project Plan

> **Last updated:** 2026-02-26
> **Audience:** New developers joining CoachPlan
> **Goal:** This document is the single-source onboarding guide for architecture, environments, workflows, and operations.

---

## 1) Product Summary

CoachPlan is a training execution platform for runners/endurance athletes.
It converts plans (template or PDF) into structured week/day/activity data, aligns plans to race date, then supports day-by-day execution with completion logging and Strava sync.

### Core Product Outcomes
- Import a training plan (PDF or template)
- Align training schedule to race date
- Execute daily workouts from dashboard/calendar
- Record actuals (distance/duration/pace)
- Sync Strava and import external activity logs into plan activities
- Support athlete/coach/admin role-specific workflows

---

## 2) Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript
- **Auth:** Clerk (`@clerk/nextjs`)
- **Database/ORM:** PostgreSQL (Neon in production) + Prisma
- **Parsing:**
  - Python parser (`scripts/parse_plan_pdf.py`, `pdfplumber`)
  - Node parser fallback (`pdfjs-dist`)
  - Optional AI enrichment pass (`OPENAI_API_KEY`, OpenAI Responses API)
- **Integrations:** Strava OAuth + sync/import mapping
- **Hosting:** Vercel

---

## 3) Environment Model (Important)

CoachPlan has one codebase with multiple runtime environments. Understand these first.

### Environment Matrix

| Environment | Hosting | DB | Auth | Notes |
|---|---|---|---|---|
| `Local dev` | Next dev server (`npm run dev`) on `http://localhost:3001` | Your configured `DATABASE_URL` | Clerk dev/prod keys in `.env` | Full app flow, local logs, easy debugging |
| `Vercel Preview` (if connected) | Vercel preview deployment | Usually Neon branch/shared DB | Clerk keys in Vercel env | Good for PR validation |
| `Vercel Production` | Vercel main deployment | Neon production DB | Clerk production keys | Live user traffic |

### Runtime Behavior Differences

- `process.env.VERCEL === true`:
  - Upload parser uses **Node PDF parser path** directly (serverless-safe)
- Local (non-Vercel):
  - Tries Python parser first, then Node fallback if needed
- Build command on Vercel is enforced:
  - `prisma generate && next build`

### No Dedicated Staging Contract (Current)

There is no strict staging environment contract in repo conventions today.
If needed, use Vercel preview deployments as staging-like validation.

---

## 4) Required Environment Variables

Do not commit secrets. Configure local `.env` and Vercel project env vars.

### Authentication / Core
- `DATABASE_URL` (required)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (required)
- `CLERK_SECRET_KEY` (required)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `CLERK_AFTER_SIGN_IN_URL`
- `CLERK_AFTER_SIGN_UP_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`
- `CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`
- `CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`

### Integrations
- `STRAVA_CLIENT_ID` (required for Strava)
- `STRAVA_CLIENT_SECRET` (required for Strava)
- `INTEGRATIONS_STATE_SECRET` (recommended; falls back to `CLERK_SECRET_KEY` if absent)
- `GARMIN_CLIENT_ID` (future/optional)
- `GARMIN_CLIENT_SECRET` (future/optional)

### AI Parsing (Optional)
- `OPENAI_API_KEY` (required to enable AI parse step)
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
- `ENABLE_AI_WEEK_PARSE=true` to enable AI week enrichment in upload route

---

## 5) Local Setup (First Day)

### Prerequisites
- Node 20+
- npm
- Python 3 (for local PDF parser path)
- PostgreSQL reachable via `DATABASE_URL`

### Install & Run
```bash
npm install
npm run dev
```

Local app URL: `http://localhost:3001`

### Database
If schema changes were introduced:
```bash
npx prisma migrate deploy
npx prisma generate
```

### First Account / Admin Bootstrap
1. Sign up through Clerk UI.
2. Promote admin if needed:
```bash
npm run make-admin -- you@example.com
```

---

## 6) Role & Access Model

### Roles
- `ATHLETE`
- `COACH`
- `ADMIN`

### How role resolution works
- Sign-in routes go to `/auth/resolve-role`
- If user has multiple available roles, user can switch via `/select-role`
- Role guards:
  - Page guard: `requireRolePage(...)`
  - API guard: `requireRoleApi(...)`

### Main guarded layouts
- Athlete pages: `/dashboard`, `/calendar`, `/progress`
- Coach pages: `/coach`
- Admin pages: `/admin`

---

## 7) High-Level Architecture Map

### UI Areas
- `/dashboard` — today-centric execution, status, Strava review/import table
- `/calendar` — monthly synthetic view + day details panel
- `/plans/[id]` — full plan view (details-heavy) with plan/calendar toggle
- `/upload` — PDF upload + parse pipeline entry
- `/plans/[id]/review` — parser output review/edit flow before publish
- `/progress` — progress summaries and links
- `/profile` — units, race defaults, integration controls
- `/coach` — template assignment and coach dashboard
- `/admin` — platform metrics + user management

### Data Domains
- User identity/roles
- Plan hierarchy: `TrainingPlan` -> `PlanWeek` -> `PlanDay` -> `PlanActivity`
- Integration accounts + external activities

### Key Libraries
- `src/lib/user-roles.ts` — role inference and current role context
- `src/lib/role-guards.ts` — page/API access enforcement
- `src/lib/user-sync.ts` — Clerk user sync into Prisma user
- `src/lib/plan-dates.ts` — week/day date alignment helpers
- `src/lib/integrations/strava.ts` — Strava OAuth, sync, import, matching
- `src/lib/openai.ts` + `src/lib/ai-plan-parser.ts` — optional AI parse pass

---

## 8) Database Model (Prisma)

Key enums:
- `UserRole`: `ATHLETE | COACH | ADMIN`
- `PlanStatus`: `DRAFT | ACTIVE | ARCHIVED`
- `ActivityType`: `RUN | STRENGTH | CROSS_TRAIN | REST | MOBILITY | YOGA | HIKE | OTHER`

Key models:
- `User`
- `CoachAthlete`
- `TrainingPlan`
- `PlanWeek`
- `PlanDay`
- `PlanActivity`
- `ExternalAccount`
- `ExternalActivity`

Important relationship note:
- `ExternalActivity.matchedPlanActivityId` links Strava activities to plan activities.

---

## 9) Critical Functional Flows

### A) Auth + User Sync
1. Clerk auth identifies user.
2. `ensureUserFromAuth` upserts user safely (without rewriting PK-based identity links).
3. Role context loaded from DB and inferred activity data.
4. User routed to role home.

### B) Plan Upload/Parse
1. Upload PDF to `POST /api/plans`.
2. Store temp file in `/tmp`.
3. Parse:
   - Local: Python parser first (`scripts/parse_plan_pdf.py`) -> Node fallback
   - Vercel: Node parser path
4. Build week/day records.
5. Deterministic activity extraction + optional AI week enrichment.
6. Normalize units/pace and persist activities.
7. If race date present, align weeks backward from race date.
8. If parser fails, create editable fallback skeleton.

### C) Plan/Calendar Unification
- Plan and Calendar are now two views of the same plan context.
- Toggle links:
  - Plan -> Calendar (`/calendar?plan=<id>`)
  - Calendar -> Plan (`/plans/<id>`)

### D) Activity Execution & Logging
- Activity complete/incomplete toggle endpoints
- Actuals patch endpoint (`distance`, `duration`, `pace`)
- Day-level manual done marker via `PlanDay.notes` (`[DAY_DONE]`)

### E) Strava Integration
1. Start connect via `/api/integrations/strava/connect`
2. OAuth callback validates signed state token
3. Exchange code for tokens
4. Initial sync from plan start to today
5. Daily review table (`/api/integrations/strava/review`)
6. Row-level import by date (`/api/integrations/strava/import-day`)

### F) Coach Flow
- Coach creates templates
- Coach assigns template to athlete (`/api/coach/assign`)
- Assignment clones structure + aligns by race date

### G) Admin Flow
- Admin access check (`src/lib/admin.ts`)
- Dashboard metrics and user management APIs

---

## 10) API Surface (By Domain)

### Plans / Parsing
- `POST /api/plans` — create plan + optional upload parse
- `GET/PATCH/DELETE /api/plans/[id]`
- `POST /api/plans/[id]/publish`
- `POST /api/plans/from-template`
- Review editing endpoints under `/api/plans/[id]/review/...`

### Activities / Days
- `POST /api/activities/[id]/toggle`
- `POST /api/activities/[id]/complete`
- `PATCH /api/activities/[id]/actuals`
- `POST /api/plan-days/[id]/complete`

### Integrations
- `GET /api/integrations/accounts`
- `DELETE /api/integrations/accounts/[provider]`
- Strava: connect/callback/sync/review/import-day/match
- Garmin: connect/sync placeholders (501 until configured)

### Coach/Admin
- Coach: templates, athletes, assign
- Admin: stats, users list/update

### User/Profile
- `GET/PUT /api/me`
- `POST /api/coach-link`

---

## 11) UI Design Language (Current)

- Strava-inspired aesthetic: Figtree font, orange accent (`#fc4c02`), light gray (`#f3f3f3`) panels, white cards, 1px border + subtle shadow
- 8px spacing refactor applied in dashboard
- Plan/Calendar shared toggle implemented
- Activity type icons are now standardized via:
  - `src/components/ActivityTypeIcon.tsx`

Canonical activity icons:
- `RUN`, `STRENGTH`, `CROSS_TRAIN`, `REST`, `MOBILITY`, `YOGA`, `HIKE`, `OTHER`

### WorkoutDetailCard (`src/components/WorkoutDetailCard.tsx`)

Reusable card component for displaying a single `PlanActivity`. Features:
- Left border accent in activity type color
- Icon pill + type label + priority badge header
- Metrics strip (distance, time, pace) on gray panel background
- Planned vs. actual comparison bars (green/amber/red by % of target)
- Effort target and coach notes sections
- Green completion banner with date
- `footer?: React.ReactNode` slot — used in calendar to inject `CalendarActivityLogger`
- `onComplete` / `onEdit` callbacks for standalone contexts (e.g. demo, future modal)

The card is integrated into the calendar day-details sidebar via `.cal-workout-cards` wrapper. All distances and paces are unit-converted server-side before being passed as props.

---

## 12) Scripts & Utilities

### Package scripts
- `npm run dev` — local dev server on port `3001`
- `npm run build` — prisma generate + next build
- `npm run start` — production start
- `npm run lint`
- `npm run test:parser-i18n` — i18n parser regression checks
- `npm run make-admin -- <email>` — promote user to admin
- `npm run backfill-plan-dates` — utility wrapper script alias

### Utility scripts
- `scripts/promote-admin.js`
- `scripts/backfill-plan-dates.js`
- `scripts/parse_plan_pdf.py`
- `scripts/test-plan-parser-i18n.mjs`

---

## 13) Deployment & Operations

### Vercel
- Build command: `prisma generate && next build`
- Ensure all env vars are set in Vercel project settings
- Keep Clerk redirect URLs aligned with deployed domains

### Database
- Production DB is expected to be Neon Postgres
- Run Prisma migrations before/with deployment process

### Integration Ops
- Strava requires valid server credentials and callback URL consistency
- Garmin endpoints intentionally return 501 until partner credentials are available

---

## 14) Debugging Playbook

### Auth loop / role issues
- Check `/api/debug-auth` and `/api/debug-cookies`
- Validate Clerk keys and redirect URLs
- Confirm `currentRole` is valid and user `isActive` is true

### Upload/parse issues
- Check server logs for parser error detail
- Verify Python availability locally
- On Vercel, remember Node parser path is used
- If parsing fails, review fallback skeleton plan and manual review flow

### Strava issues
- Confirm `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`
- Ensure callback URL matches environment origin
- Verify account exists in `ExternalAccount`
- Run sync endpoint and inspect summary metrics

### Date alignment issues
- Validate `raceDate`
- Run `scripts/backfill-plan-dates.js` in dry run first

---

## 15) Known Gaps / Roadmap

### Recently completed (2026-02-26 session)
- **Profile — pace targets expanded**: 7-zone display (recovery/easy/long/race/tempo/threshold/interval) with race goal calculator (distance dropdown + goal time + Calculate). Client-side Riegel formula matches backend `derivePaceProfileFromRaceTarget()`. Zone values pre-populated from stored `paceTargets.raceGoal` metadata on load. Pace zones summary chips added to Current Setup sidebar.
- **Profile — goalRaceDate removed from UI**: Field removed from profile form; silently preserved in save payload to avoid wiping stored values. Race date is now per-plan only.
- **Profile — Strava section compliance**: Branded "Connect with Strava" button only when disconnected; Sync + Disconnect + muted Reconnect when connected.
- **Upload — race date required and promoted to #1**: Race date field is now field #1 with required validation before submit. Orange asterisk (*) indicator. Order: race date → race name → plan name → PDF.
- **Template → active plan flow**: "Use template" now expands an inline form inside the template card, requiring race date before creating the plan. No more floated plans without date alignment.

### Remaining gaps
1. Garmin integration completion
2. Coach feedback/comments loop on day/activity
3. Strava conflict-resolution UX for same-day multi-match
4. Admin moderation/audit trail depth
5. Mobile polish across dashboard/calendar/detail
6. Click-through from calendar day cell to workout detail modal (currently day click → sidebar only)
7. Pace personalization surface in plan detail view ("Personalize paces for this plan" CTA linking to profile)
8. Planned vs. actual pace comparison in calendar + pace trend in progress page

---

## 16) New Developer Onboarding Checklist

### Day 1
1. Configure `.env` with required keys.
2. Run `npm install` and `npm run dev`.
3. Confirm sign-in and role resolution.
4. Create/upload a sample plan and inspect `/plans/[id]/review`.
5. Walk through dashboard -> plan -> calendar toggle.

### Day 2
1. Connect Strava in profile.
2. Run sync and day import.
3. Inspect DB records for `ExternalActivity` mapping.
4. Review core route files under `src/app/api/plans` and `src/app/api/integrations/strava`.

### Week 1
1. Ship one small end-to-end feature touching UI + API + Prisma.
2. Validate in local + Vercel preview.
3. Document any new env var or operational runbook update in this file.

---

## 17) Documentation Maintenance Rule

When major behavior changes, update this file in the same PR:
- environment/runtime assumptions,
- API contracts,
- role/access behavior,
- parser/integration flow,
- ops commands and debugging steps.

