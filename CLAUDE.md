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
- Garmin routes currently return `501 NOT_CONFIGURED` until partner credentials are available.
- Use `PROJECT_PLAN.md` as the current handover/status document.
- For visual changes, follow `AI_DESIGN_RULES.md`; use `design-system/coachplan/MASTER.md` as primary design reference and `CONVENTIONS.md` for per-page layout model details.

## End-of-session handover

Before handoff, update docs and push:

```bash
git status --short -- '*.md'
git add ':(glob)**/*.md'
git commit -m "docs: handover update"
git push origin main
```

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
