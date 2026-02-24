# Codebase Structure

**Analysis Date:** 2025-02-24

## Directory Layout

```
coachplan/
├── prisma/
│   ├── schema.prisma           # PostgreSQL schema: User, Plan, Week, Day, Activity, Strava
│   └── migrations/             # Versioned DB migrations
├── scripts/
│   ├── parse_plan_pdf.py       # Legacy PDF text extraction (Python 3)
│   └── *.mjs                   # Audit, admin promotion utilities
├── src/
│   ├── app/                    # Next.js App Router pages & API routes
│   ├── components/             # React UI components
│   ├── lib/                    # Shared utilities & business logic
│   └── middleware.ts           # Clerk auth middleware
├── .env.example                # Template for required env vars
├── tsconfig.json               # TypeScript config with @/* path alias
├── next.config.js              # Next.js build & runtime config
├── package.json                # Node 22.x, Next 16, React 19
└── CLAUDE.md                   # Project instructions
```

## Directory Purposes

**`src/app/`:**
- Purpose: Next.js App Router pages, layouts, and API routes
- Contains: TSX page components, API route handlers, CSS modules
- Auth flow: Pages redirect via Clerk middleware to `/sign-in`, post-signin → `/auth/resolve-role`
- Role-based nav: Header component (`src/components/Header.tsx`) renders nav based on currentRole

**`src/app/api/`:**
- Purpose: REST API endpoints for all CRUD operations
- Subdirectories by resource: `plans/`, `activities/`, `integrations/`, `coaches/`, `templates/`, `admin/`
- Auth pattern: All routes call `await currentUser()` and return 401 if missing
- Most routes support both read (GET) and write (POST/PATCH/DELETE)

**`src/app/api/plans/[id]/`:**
- `route.ts` — GET plan full data; PATCH metadata (raceName, raceDate, status); DELETE plan
- `reparse/route.ts` — POST to re-run full Parser V4 on existing plan
- `reparse-day/route.ts` — POST to re-parse single day (targeted fix)
- `review/` — Subroutes for plan review workflow (see structure below)
- `extract-guide/route.ts` — Extract coach guide text via AI
- `ai-adjust/route.ts` — AI trainer adjustments
- `save-as-template/route.ts` — Clone as template
- `publish/route.ts` — Mark ACTIVE
- `source-document/` — PDF retrieval

**`src/app/api/plans/[id]/review/`:**
- Purpose: Editing interface while plan is in DRAFT; user can correct parsed activities
- `days/[dayId]/route.ts` — GET/PATCH single day notes
- `days/[dayId]/activities/route.ts` — List day's activities
- `activities/[activityId]/route.ts` — GET/PATCH single activity

**`src/app/api/integrations/strava/`:**
- `connect/route.ts` — Initiate OAuth → Strava
- `callback/route.ts` — Handle Strava redirect, store tokens
- `sync/route.ts` — Fetch recent activities from Strava
- `match/route.ts` — Match external activities to plan activities
- `review/route.ts` — User review/confirm matches
- `import-day/route.ts` — Single-day manual import

**`src/app/api/activities/[id]/`:**
- `actuals/route.ts` — POST to log activity performance (distance, duration, pace)
- `complete/route.ts` — POST to mark activity completed
- `toggle/route.ts` — Toggle completion state

**`src/app/dashboard/`:**
- `page.tsx` — Athlete's home: today's plan summary, quick activity logger, Strava status
- `dashboard.css` — Shared design tokens (colors, spacing, responsive breakpoints)

**`src/app/calendar/`:**
- `page.tsx` — Training log: full plan calendar with day-picker, detail card for selected day
- `calendar.css` — Calendar-specific styles (grid, cells, highlight)

**`src/app/plans/[id]/`:**
- `page.tsx` — Plan detail view: activities list, AI trainer panel (right sidebar), guide panel
- `review/page.tsx` — Plan review workflow (coach reviewing athlete's logged activities)

**`src/app/upload/`:**
- `page.tsx` — Coach/Athlete PDF upload form; triggers `POST /api/plans`

**`src/app/coach/`:**
- `page.tsx` — Coach roster view: list athletes, assign plans, view athlete progress

**`src/app/strava/`:**
- `page.tsx` — Strava import page: OAuth button, recent activities, match review

**`src/app/admin/`:**
- `page.tsx` — Admin panel: user stats, bulk operations
- `parse-debug/` — Debug parse artifacts from ParseJob history

**`src/app/auth/resolve-role/`:**
- `page.tsx` — Post-signin role detection and DB sync

**`src/app/select-role/`:**
- `page.tsx` — Role switcher for users with multiple roles (ATHLETE + COACH)

**`src/app/profile/`, `progress/`, `discover/`, `guide/`:**
- Athlete/Coach secondary pages (under development)

**`src/components/`:**
- Purpose: Reusable React components for pages and forms
- Naming: PascalCase + descriptive (e.g., `DayLogCard.tsx`, `StravaActivityMatchTable.tsx`)
- Patterns:
  - Components that fetch data use `async` (server components)
  - Form handlers use client-side hooks for interactivity
  - Icons use dedicated component files (`ActivityTypeIcon.tsx`, `ExternalSportIcon.tsx`, `StravaIcon.tsx`)

**Key Components:**
- `Header.tsx` — Top nav bar with role badge, nav links, sign-out
- `AthleteSidebar.tsx` — Left sidebar: plan selector, week navigator
- `PlanSidebar.tsx` — Right sidebar for plan detail pages
- `DayLogCard.tsx` — Collapsible day detail card (activities + external logs)
- `DayCompletionButton.tsx` — Mark day DONE/MISSED/REOPEN
- `StravaActivityMatchTable.tsx` — Review Strava matches before import
- `DashboardActivityLogCard.tsx` — Quick activity form (dashboard)
- `PlanGuidePanel.tsx` — Coach guide (extracted via AI)
- `PlanSummaryCard.tsx`, `PlanSummarySection.tsx` — Race info, build stats
- `PlanEditor/ActivityForm.tsx` — Edit single activity fields
- `ui/Modal.tsx` — Reusable modal wrapper

**`src/lib/`:**
- Purpose: Shared business logic, utilities, integrations
- No circular imports; utilities import down to database/external services only

**`src/lib/prisma.ts`:**
- Singleton Prisma client with global caching (dev mode only)
- Logs only error/warn levels

**`src/lib/openai.ts`:**
- AI provider abstraction (OpenAI, Cloudflare, Gemini)
- `openaiJsonSchema()` — Call AI with strict JSON response format
- `resolveAIProvider()` — Read AI_PROVIDER env var
- Handles response unwrapping, error extraction, JSON parsing

**`src/lib/parsing/`:**
- `plan-parser-v4.ts` — Core Parser V4: iterates weeks, parses activities, extracts intensity
- `v4-to-plan.ts` — Transforms ProgramJsonV1 into TrainingPlan/Week/Day/Activity DB records
- `parse-artifacts.ts` — ParseJob creation, status updates, artifact storage

**`src/lib/ai-plan-parser.ts`:**
- `parseWeekWithAI()` — Call OpenAI for single week
- `maybeRunParserV4()` — Decide which parser to use (feature flag)

**`src/lib/ai-guide-extractor.ts`:**
- Extract human-readable coach guide from plan PDF

**`src/lib/ai-summary-extractor.ts`:**
- Extract plan summary (race type, difficulty, build focus)

**`src/lib/intensity-targets.ts`:**
- `extractPaceTargetFromText()` — Parse "8:30-9:00 min/mi" or "easy" → normalized format
- `extractEffortTargetFromText()` — Parse "zone 2" or "140-160 bpm" → effort range
- `deriveStructuredIntensityTargets()` — Full intensity analysis on activity text

**`src/lib/unit-display.ts`:**
- `convertDistanceForDisplay()` — mi ↔ km with format object {value, unit}
- `distanceUnitLabel()` — "mi" vs "km"
- `resolveDistanceUnitFromActivity()` — Infer unit from activity metadata

**`src/lib/day-status.ts`:**
- `getDayStatus()` — Parse notes string → DayStatus
- `setDayStatus()` — Encode status tags into notes
- `isDayExplicitlyOpen()` — Check for `[DAY_OPEN]` override

**`src/lib/log-activity.ts`:**
- `buildLogActivities()` — Transform PlanActivity[] + viewerUnits → LogActivity[] (display format)
- `buildPlannedMetricParts()` — Format distance/duration/pace for UI

**`src/lib/integrations/strava.ts`:**
- OAuth flow, token refresh
- `fetchStravaActivities()` — Get recent external activities
- Activity data mapping (sportType → ActivityType)

**`src/lib/integrations/strava-equivalence.ts`:**
- `calculateEquivalence()` — Compare Strava activity vs planned activity
- Distance/duration/time-of-day matching logic
- Confidence scoring

**`src/lib/user-roles.ts`:**
- `getCurrentUserRoleContext()` — Sync Clerk user to DB, detect available roles
- `getRoleHomePath()` — `/dashboard` for ATHLETE, `/coach` for COACH
- Role inference from data (coach links, templates, plans)

**`src/lib/user-sync.ts`:**
- `ensureUserFromAuth()` — Upsert user record from Clerk token

**`src/lib/plan-dates.ts`:**
- `alignWeeksToRaceDate()` — Calculate start/end dates for each week based on race date
- `resolveWeekBounds()` — Get week start/end for a given date

**`src/lib/plan-selection.ts`:**
- Cookie-based active plan selection (`SELECTED_PLAN_COOKIE`)
- `pickSelectedPlan()` — Load plan from cookie or fetch latest

**`src/lib/pace-personalization.ts`:**
- Adjust pace targets based on athlete's recorded paces

**`src/lib/plan-document-profile.ts`:**
- Detect document structure (table-based, list-based, hybrid)
- `buildProgramDocumentProfile()` — Analyze PDF layout for better parsing

**`src/lib/pdf/extract-text.ts`:**
- Extract text from PDF using pdfjs-dist (browser) or Python script (server)

**`src/lib/schemas/program-json-v1.ts`:**
- TypeScript interface for Parser V4 output
- Canonical intermediate format between AI and DB

**`src/lib/types/plan-summary.ts`:**
- TypeScript types for plan summary (race, build phases)

## Key File Locations

**Entry Points:**
- `src/app/page.tsx` — Public landing page
- `src/app/layout.tsx` — Root layout with Clerk provider, Header, nav routing
- `src/app/dashboard/page.tsx` — Athlete home
- `src/app/calendar/page.tsx` — Training log
- `src/app/plans/[id]/page.tsx` — Plan detail with AI trainer
- `src/app/upload/page.tsx` — PDF upload form

**Configuration:**
- `prisma/schema.prisma` — Database schema (models, enums, relations)
- `tsconfig.json` — Path alias `@/*` → `src/*`
- `.env.example` — Template for required secrets (OPENAI_API_KEY, DATABASE_URL, CLERK_*)
- `next.config.js` — Webpack, experimental flags

**Core Logic:**
- `src/lib/parsing/plan-parser-v4.ts` — Parser V4 engine
- `src/lib/ai-plan-parser.ts` — AI orchestration
- `src/lib/integrations/strava.ts` — Strava OAuth and sync
- `src/lib/day-status.ts` — Day completion state machine
- `src/lib/user-roles.ts` — Role detection and context

**Testing & Debug:**
- `src/app/admin/parse-debug/page.tsx` — View ParseJob artifacts
- `src/app/api/debug-auth/route.ts` — Debug Clerk context
- `scripts/*.mjs` — Audit, admin promotion scripts

## Naming Conventions

**Files:**
- Pages: `page.tsx` (Next.js convention)
- API routes: `route.ts` (Next.js convention)
- Components: PascalCase (e.g., `DayLogCard.tsx`)
- Utilities: camelCase (e.g., `day-status.ts`)
- Styles: `*.css` or `*.module.css` (component-scoped)
- Types: `*.ts` or embedded in files

**Directories:**
- Feature pages: lowercase with hyphens (e.g., `/plans/[id]/review`)
- Dynamic routes: `[param]` syntax (Next.js convention)
- Grouped routes: `(group)` syntax if needed (not currently used)

**Functions:**
- Async transformers: `build*` prefix (e.g., `buildLogActivities`)
- Status readers: `get*` or `is*` (e.g., `getDayStatus`, `isDayMarkedDone`)
- Converters: `convert*` or `resolve*` (e.g., `convertDistanceForDisplay`, `resolveDistanceUnitFromActivity`)
- Extractors: `extract*` (e.g., `extractPaceTargetFromText`)
- Setters: `set*` (e.g., `setDayStatus`)

**Constants:**
- UPPERCASE_WITH_UNDERSCORES (e.g., `DAY_DONE_TAG`, `SELECTED_PLAN_COOKIE`)

## Where to Add New Code

**New Feature (End-to-End):**
1. Database schema: `prisma/schema.prisma` → `npx prisma migrate dev`
2. API route: `src/app/api/[resource]/route.ts` (or `src/app/api/[resource]/[id]/[action]/route.ts`)
3. Business logic: `src/lib/[domain].ts` (e.g., `src/lib/my-feature.ts`)
4. Components: `src/components/MyFeatureComponent.tsx`
5. Page: `src/app/[feature]/page.tsx` (if public-facing)

**New Component:**
- File: `src/components/MyComponent.tsx`
- If server component: Can directly call prisma/Clerk
- If client component: Use `'use client'` directive, props for data
- Styles: Import adjacent `MyComponent.css` or use `*.module.css`

**New Utility/Helper:**
- File: `src/lib/my-utility.ts`
- Export individual functions, not default export
- Type-safe: Include JSDoc and TypeScript types
- No database access unless the filename indicates it (e.g., `user-sync.ts`)

**New Integration (External API):**
- File: `src/lib/integrations/[provider].ts`
- Patterns: OAuth flow, token storage, error handling, type-safe responses
- Reference: `src/lib/integrations/strava.ts` for example

**New API Endpoint:**
- Path: `src/app/api/[resource]/[optional-id]/[optional-action]/route.ts`
- Follow pattern:
  ```typescript
  import { currentUser } from '@clerk/nextjs/server';
  import { NextResponse } from 'next/server';

  export async function GET/POST(req, { params }) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // ... logic
    return NextResponse.json({ ... });
  }
  ```
- Auth check always first
- Validate params and body
- Use `src/lib/prisma.ts` for DB access

## Special Directories

**`prisma/migrations/`:**
- Purpose: Versioned database schema changes
- Generated: By `npx prisma migrate dev` (DO NOT EDIT)
- Committed: Yes, one migration per schema update

**`src/app/design/`:**
- Purpose: Design system/playground pages (not for users)
- Generated: No
- Committed: Yes (for design review)

**`scripts/`:**
- Purpose: Utility scripts (not part of app)
- Examples: PDF extraction, admin promotion, audit capture
- Run: `node scripts/script-name.mjs` (after build if needed)

**`src/app/api/pdfjs/worker/`:**
- Purpose: pdfjs worker thread (required for PDF parsing in browser)
- Generated: By pdfjs-dist
- Committed: Yes

---

*Structure analysis: 2025-02-24*
