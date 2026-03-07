# MyTrainingPlan — Developer Quick Context

Training plan management app for endurance athletes and coaches.

## Core architecture

- Frontend: Next.js 16 + React 19 + TypeScript
- DB: Prisma + PostgreSQL
- Auth: Clerk (`@clerk/nextjs`)
- Middleware/proxy: `src/proxy.ts`
- Parsing pipeline:
  - PDF text extraction (Python-first locally, Node fallback)
  - v4/v5 parser paths
  - structured persistence into `TrainingPlan -> PlanWeek -> PlanDay -> PlanActivity`

## Core user flows

- Upload PDF -> draft parse -> review/correct -> activate
- Activation requires scheduling mode for active plans:
  - `RACE_DATE` or `START_DATE`
- Daily execution/logging on dashboard/calendar/plan-day panels
- Strava connect -> sync -> review/match -> import

## Commands

- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run verify`
- `npm run test:parser-i18n`
- `npm run make-admin -- <email>`

## File map

- `src/app/` — pages/routes
- `src/app/api/` — API routes
- `src/components/` — shared UI
- `src/lib/` — domain logic (roles, parsing, integrations)
- `prisma/schema.prisma` — source of truth for data model
- `scripts/` — parser/testing/admin utilities

## Operational notes

- Keep `.env.local` aligned with `.env.example`.
- Garmin routes currently return `501 NOT_CONFIGURED` until partner credentials are available.
- Use `PROJECT_PLAN.md` as the current handover/status document.
- For visual changes, follow `AI_DESIGN_RULES.md` and `CONVENTIONS.md`.

## End-of-session handover

Before handoff, update docs and push:

```bash
git status --short -- '*.md'
git add ':(glob)**/*.md'
git commit -m "docs: handover update"
git push origin main
```
