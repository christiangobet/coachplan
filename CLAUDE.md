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
- `design-system/coachplan/MASTER.md` — canonical visual + component design system (tokens, dark mode, iOS quirks, anti-patterns, pre-delivery checklist)

## Operational notes

- Keep `.env.local` aligned with `.env.example`.
- Use `PROJECT_PLAN.md` as the current handover/status document.
- For visual changes, follow `AI_DESIGN_RULES.md`; use `design-system/coachplan/MASTER.md` as primary design reference and `CONVENTIONS.md` for per-page layout model details.

## Model routing

Default subagents to the cheapest capable model:
- **Haiku** — file reads, grep/glob searches, counting, data gathering, simple checks
- **Sonnet** — analysis, synthesis, code writing, reviews, multi-step reasoning
- **Opus** — complex architecture decisions, cross-cutting synthesis only
