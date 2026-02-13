# CoachPlan

Training plan management app for endurance athletes and coaches. Upload PDF training plans, align to race dates, track workouts, and monitor progress.

## Tech Stack

- **Framework:** Next.js 16 (App Router) with TypeScript
- **Auth:** Clerk (`@clerk/nextjs`)
- **Database:** PostgreSQL with Prisma ORM
- **AI:** OpenAI API (gpt-4o-mini) for PDF plan parsing
- **PDF Parsing:** Python 3 with pdfplumber
- **Path alias:** `@/*` → `./src/*`

## Commands

- `npm run dev` — Start dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npx prisma migrate dev` — Run database migrations
- `npx prisma generate` — Regenerate Prisma client after schema changes

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components
- `src/lib/` — Shared utilities (Prisma client, OpenAI, AI parser schema)
- `src/middleware.ts` — Clerk auth middleware
- `prisma/schema.prisma` — Database schema
- `scripts/parse_plan_pdf.py` — PDF text extraction script

## Key Patterns

- API routes live under `src/app/api/`
- Use `@/lib/prisma` for database access (singleton pattern)
- Clerk handles auth; use `auth()` in API routes, `currentUser()` in server components
- Two user roles: ATHLETE and COACH
- Plans have statuses: DRAFT → ACTIVE → ARCHIVED
- UI follows Strava-inspired aesthetic: Figtree font, orange accent (#fc4c02), light gray background, white cards

## Project Plan

See `PROJECT_PLAN.md` for full project status, stages, checklist, and progress tracking.

**At the end of every session, update `PROJECT_PLAN.md`** — refresh progress %, check off completed items, and set next actions.
