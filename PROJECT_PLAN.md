# MyTrainingPlan — Implementation Status & Handover

> Last updated: 2026-03-07
> Scope: status synced to current codebase implementation

---

## 1) Product snapshot

MyTrainingPlan converts training plans (PDF or templates) into structured execution workflows for athletes and coaches.

Current end-to-end flow:
1. Upload PDF to create a `DRAFT` plan.
2. Review and correct parsing output in `/plans/[id]/review`.
3. Activate plan with scheduling mode (`RACE_DATE` or `START_DATE`).
4. Execute day-by-day on dashboard/calendar/plan view.
5. Import Strava activity data to populate logged actuals.

---

## 2) What is implemented now

### Platform and architecture
- Next.js 16 + React 19 + TypeScript.
- Prisma schema includes role, plan, activity, and external integration models.
- Clerk auth with role resolution and retry-safe `/auth/resolve-role` flow.
- Middleware/proxy is in `src/proxy.ts`.

### Role and navigation model
- Roles: `ATHLETE`, `COACH`, `ADMIN`.
- Athlete default surfaces: `/dashboard`, `/calendar`, `/plans`, `/strava`, `/progress`, `/profile`.
- Role-specific nav in layout/header.
- Multi-role users can switch via `/select-role`.

### Plan lifecycle and scheduling
- Plan statuses: `DRAFT`, `ACTIVE`, `ARCHIVED`.
- Activation enforces scheduling mode:
  - `weekDateAnchor = RACE_DATE` requires `raceDate`.
  - `weekDateAnchor = START_DATE` requires `startDate`.
- Scheduling mode is applied at activation/active transitions; draft review remains unscheduled/editable.

### Parsing and review
- Upload route supports parser orchestration and quality scoring.
- v4 parser supports full-text pass strategy and week coverage handling.
- Plan guide extraction and summary surfaces are integrated.
- Review screen supports day/activity correction, reparsing, and session instruction workflows.

### Execution and logging UX
- Session-flow pattern is available in logging contexts.
- Planned vs logged actuals are kept separate (`distance/duration` vs `actualDistance/actualDuration`).
- Compact distance rendering prefers one decimal.
- Day status supports `OPEN`, `DONE`, `PARTIAL`, `MISSED` via notes tags + completion logic.

### Strava integration
- Connect/callback/sync/review/import routes implemented.
- Match/import supports session grouping and proportional handling for grouped sessions.
- Import/review appears in `/strava` and day-level context.

### Garmin integration
- API stubs exist, but connect/sync currently return `501 NOT_CONFIGURED`.

### Branding and landing
- Brand component (`BrandLogo`) introduced.
- Uses:
  - `public/branding/mytrainingplan-logo-full.png`
  - `public/branding/mytrainingplan-logo-mark.png`
- Landing and app chrome now use MyTrainingPlan branding.

### Responsive layout status
- Dashboard uses 3 -> 2 -> 1 behavior by breakpoint.
- Calendar, plan view, and strava pages have dedicated responsive behavior and mobile adaptations.
- Mobile navigation is present; iPhone-width behavior has targeted fixes for day panels and cards.

---

## 3) Current UI layout model (as coded)

### Dashboard (`dash-grid`)
- Large desktop: left + center + right columns.
- <=1380px: left + center (right hidden).
- <=768px: single column with side panels hidden.

### Calendar (`/calendar`)
- Base desktop: left + center.
- Desktop when day selected (`.cal-day-open`): right day panel column is shown.
- <=900px: single column; left sidebar hidden.

### Plan view (`/plans/[id]`)
- Base desktop: left + main.
- Day panel is a right fixed panel that opens when a day is selected.
- <=900px: day panel becomes full-screen style overlay panel.

### Strava (`/strava`)
- Desktop: left + center.
- <=900px: single column, with inline mobile sync panel.

---

## 4) API surface (high-level)

### Plans
- `/api/plans` (create/upload/parse)
- `/api/plans/[id]` (read/update/delete with scheduling constraints)
- `/api/plans/[id]/publish`
- `/api/plans/[id]/review/*`
- `/api/plans/from-template`
- `/api/plans/[id]/source-document/*`

### Activities and day completion
- `/api/activities/[id]/toggle`
- `/api/activities/[id]/complete`
- `/api/activities/[id]/actuals`
- `/api/plan-days/[id]/complete`

### Integrations
- `/api/integrations/accounts`
- Strava: connect/callback/sync/review/import/match/webhook
- Garmin: connect/sync (not configured)

### Role surfaces
- Coach: templates/athletes/assign flows under `/api/coach/*`
- Admin: parser prompts, users, stats under `/api/admin/*`

---

## 5) Known gaps / active backlog

1. Garmin production integration (credentials + end-to-end flow).
2. Further cleanup of cross-page responsive consistency for complex side panels.
3. Expanded analytics in progress view (planned vs logged trend depth).
4. Coach-to-athlete feedback loop depth and moderation/audit tooling.

---

## 6) Verification baseline for handovers

Run before claiming a stable handover:

```bash
npm run typecheck
npm run verify
```

If docs changed:

```bash
git status --short -- '*.md'
```

---

## 7) Documentation rule

When behavior changes in routes/layout/flows:
- update `README.md` (setup + user flow)
- update `CLAUDE.md` (developer quick context)
- update this file (`PROJECT_PLAN.md`) with concrete implementation state
- update `CONVENTIONS.md` when breakpoints/layout patterns change
