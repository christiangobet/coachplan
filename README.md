# MyTrainingPlan (CoachPlan)

MyTrainingPlan is a Next.js training-platform app for athletes and coaches.
It parses PDF plans into structured weeks/days/activities, supports review before activation, and tracks execution with Strava sync.

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Prisma + PostgreSQL
- Clerk auth + role resolution (Athlete / Coach / Admin)
- PDF parsing: Python (`pdfplumber`) with Node fallback (`pdfjs-dist`)
- AI parsing/enrichment: provider-based (`openai` by default; cloudflare/gemini supported)

## Local setup

1. Use Node `22.x`.
2. Install dependencies:

```bash
npm install
```

3. Create local env file:

```bash
cp .env.example .env.local
```

4. Fill required values in `.env.local`:
- `DATABASE_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Optional integrations/parsing:
- `OPENAI_API_KEY` (or other provider keys)
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
- `APP_URL` (recommended for stable OAuth callbacks, especially Strava)

5. Start app:

```bash
npm run dev
```

App URL: `http://localhost:3001`

For OAuth integrations such as Strava, set `APP_URL` to the canonical public app origin you registered with the provider, for example `https://www.mytrainingplan.io`. This prevents callback URLs from changing based on preview, tunnel, or localhost hosts.

## Key commands

- `npm run dev` — local dev server on port 3001
- `npm run typecheck` — TypeScript check
- `npm run lint` — ESLint
- `npm run build` — production build
- `npm run verify` — Prisma generate + typecheck + build
- `npm run test:parser-i18n` — parser normalization checks
- `npm run make-admin -- <email>` — promote user to admin

## Product flow (current)

1. Upload PDF -> draft plan is created.
2. Review/correct in `/plans/[id]/review`.
3. Activate plan with scheduling mode:
- `RACE_DATE` (anchor end to race date), or
- `START_DATE` (use provided start date as week 1).
4. Execute in dashboard/calendar/plan view.
5. Sync and import Strava activities into plan execution logs.

## Main screens

- `/dashboard` — today focus, next up, logging and quick status
- `/calendar` — active-plan training calendar + selected day panel
- `/plans/[id]` — detailed plan view + day panel + optional source PDF pane
- `/upload` — PDF upload + staged parsing progress and flow stepper
- `/strava` — sync/import table and reconciliation workflow
- `/profile` — units, role/account settings, integration controls
- `/coach`, `/admin` — coach/admin tools

## Build parity with Vercel

Run before pushing:

```bash
npm run verify
```

`vercel.json` uses:

```json
{
  "buildCommand": "prisma generate && next build"
}
```

## Notes

- Middleware/auth proxy is implemented in `src/proxy.ts`.
- Canonical UI system and layout conventions are in `CONVENTIONS.md`.
- Parsing constraints and safety rules are in `AI_PARSING_RULES.md`.
