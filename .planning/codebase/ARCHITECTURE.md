# Architecture

**Analysis Date:** 2025-02-24

## Pattern Overview

**Overall:** Server-driven Next.js app with role-based access (ATHLETE, COACH, ADMIN) orchestrating PDF→structure→execution workflow

**Key Characteristics:**
- Server components (RSCs) on critical paths (dashboard, calendar, plans) for data consistency
- API routes as data layer with Clerk auth guards
- AI-powered PDF parsing (OpenAI default, Cloudflare/Gemini fallbacks) converting PDFs to structured plans
- Prisma ORM with PostgreSQL storing hierarchical plan data (Plan → Week → Day → Activity)
- Strava integration for external activity matching and sync
- Client-side state management minimal (one selected plan via cookie)

## Layers

**Presentation Layer (React Components):**
- Purpose: Render UI in Next.js App Router pages and server components
- Location: `src/components/`, `src/app/*/page.tsx`, `src/app/*/layout.tsx`
- Contains: React components, page shells, form handlers
- Depends on: API routes, shared utilities (`@/lib`)
- Used by: End users via browser

**Page/Route Layer (Next.js App Router):**
- Purpose: Handle URL routing, page composition, auth checks
- Location: `src/app/**/page.tsx` (pages), `src/app/api/**/route.ts` (endpoints)
- Contains: Server components, API endpoints, layout wrapping
- Depends on: Prisma, Clerk, shared utilities
- Used by: Browser requests

**API/Data Access Layer:**
- Purpose: REST endpoints managing plans, activities, integrations, user data
- Location: `src/app/api/*/route.ts`
- Key endpoints:
  - `POST /api/plans` — Upload PDF and trigger parsing pipeline
  - `GET/PATCH /api/plans/[id]` — Retrieve/update plan metadata
  - `GET/POST /api/plans/[id]/review/*` — Plan review (parsing corrections)
  - `POST /api/plans/[id]/reparse` — Re-run full parse on existing plan
  - `GET/POST /api/activities/[id]/*` — Log activity actuals
  - `GET/POST /api/integrations/strava/*` — Strava auth and sync
  - `GET /api/coach/*` — Coach roster and plan assignments
- Depends on: Prisma, AI providers, file system
- Used by: Frontend, external webhooks

**Business Logic Layer (Parsing & Transformations):**
- Purpose: Core algorithms for plan parsing, data transformation, activity matching
- Location: `src/lib/*` (excluding integrations)
- Key modules:
  - **AI & Parsing:** `ai-plan-parser.ts`, `ai-guide-extractor.ts`, `ai-summary-extractor.ts`
  - **Parsing Pipeline:** `src/lib/parsing/plan-parser-v4.ts`, `src/lib/parsing/v4-to-plan.ts`
  - **Intensity/Pace:** `intensity-targets.ts`, `pace-estimation.ts`, `pace-personalization.ts`
  - **Status Tracking:** `day-status.ts` (manages day completion state via notes tags)
  - **Activity Building:** `log-activity.ts` (transforms DB records into display format)
  - **Units & Display:** `unit-display.ts` (handles miles ↔ km conversions)
  - **Auth & Roles:** `user-roles.ts`, `user-sync.ts`, `role-guards.ts`
- Depends on: Prisma, OpenAI, Strava SDK
- Used by: API routes, server components

**Integration Layer:**
- Purpose: External service connections (Strava, Garmin, AI providers)
- Location: `src/lib/integrations/`, `src/lib/openai.ts`, `src/lib/pdf/`
- Key integrations:
  - **Strava:** OAuth flow, activity fetch, equivalence matching, sync state
  - **PDF Processing:** pdfjs-dist for web, Python script for backend extraction
  - **AI:** OpenAI (primary), Cloudflare, Google Gemini (fallbacks) with JSON schema mode
- Depends on: External APIs, file system
- Used by: Parsing pipeline, activity sync

**Database Layer:**
- Purpose: PostgreSQL persistence via Prisma
- Location: `prisma/schema.prisma`, `src/lib/prisma.ts`
- Key models:
  - **User:** Identity, role (ATHLETE/COACH/ADMIN), settings
  - **TrainingPlan:** Container with status (DRAFT/ACTIVE/ARCHIVED), race alignment
  - **PlanWeek/PlanDay/PlanActivity:** Hierarchical plan structure
  - **ExternalAccount/ExternalActivity:** Strava/Garmin data + equivalence matching
  - **ParseJob/ParseArtifact:** Parsing job history and validation
- Depends on: PostgreSQL
- Used by: All app layers

## Data Flow

**Plan Upload → Parse → Execute:**

1. **Upload & Initial Parse**
   - User `POST /api/plans` with PDF file
   - Backend extracts PDF text (pdfjs-dist or Python script)
   - Creates TrainingPlan record in DRAFT status
   - Stores PDF in PlanSourceDocument
   - Triggers `parseWeekWithAI()` or `maybeRunParserV4()` (V4 uses parallel job queue)

2. **AI Parsing (Parser V4 Pipeline)**
   - For each week/day, calls `openaiJsonSchema()` with week structure schema
   - Extracts activity types, distance, pace targets, effort targets
   - Applies `deriveStructuredIntensityTargets()` to parse effort zones
   - Saves ParseJob and ParseArtifact records for audit trail
   - On success: `populatePlanFromV4()` writes PlanWeek/PlanDay/PlanActivity rows

3. **Plan Alignment**
   - User sets race date in PATCH `/api/plans/[id]`
   - Calls `alignWeeksToRaceDate()` which calculates start/end dates for each week
   - Updates PlanWeek.startDate/endDate fields

4. **Daily Execution (Athlete View)**
   - Server component `src/app/calendar/page.tsx` loads plan for selected date
   - Queries PlanDay + PlanActivity + ExternalActivity for that day
   - Builds `LogActivity[]` via `buildLogActivities()` with unit conversions
   - Renders DayLogCard showing planned activities and actual logs
   - User logs actuals via `POST /api/activities/[id]/actuals` → updates PlanActivity fields

5. **Strava Sync**
   - User connects Strava via OAuth at `src/app/api/integrations/strava/callback`
   - Backend stores ExternalAccount with accessToken/refreshToken
   - On `GET /api/integrations/strava/sync` (manual or auto), fetches recent ExternalActivity records
   - Calls `calculateEquivalence()` in `strava-equivalence.ts` to match plan activities
   - Updates ExternalActivity.matchedPlanActivityId + equivalence confidence
   - User reviews/confirms matches in `/plans/[id]/review` UI

**State Management:**

- **Plan Selection:** Single cookie `SELECTED_PLAN` (athlete's active plan)
- **Day Status:** Encoded in PlanDay.notes using tags: `[DAY_DONE]`, `[DAY_MISSED]`, `[DAY_OPEN]`, `[DAY_MISSED_REASON]...`
- **User Role Context:** Cached in server component root (layout.tsx) via `getCurrentUserRoleContext()`
- **Parsing State:** Audit trail in ParseJob/ParseArtifact (immutable); plan state progresses DRAFT → ACTIVE → ARCHIVED

## Key Abstractions

**ProgramJsonV1:**
- Purpose: Canonical intermediate format from Parser V4
- Location: `src/lib/schemas/program-json-v1.ts`
- Pattern: Strict schema with week/session arrays, intensity, distance, duration
- Used by: Parser V4 output, `populatePlanFromV4()` input

**DayStatus:**
- Purpose: Represents day completion state (OPEN/DONE/MISSED/PARTIAL)
- Examples: `src/lib/day-status.ts`
- Pattern: Encode as text tags in PlanDay.notes field (CQRS-like; append-only)

**LogActivity:**
- Purpose: Presentation model for a single activity in athlete's day view
- Examples: `src/lib/log-activity.ts`
- Pattern: Transform PlanActivity + ExternalActivity + viewerUnits → display-ready object

**PaceTarget & EffortTarget:**
- Purpose: Parse and structure intensity guidance (pace ranges, effort zones, RPE, HR)
- Examples: `src/lib/intensity-targets.ts`
- Pattern: Extract symbolic ("easy"), numeric (8:30-9:00 min/mi), or range values

**ActivityEquivalence:**
- Purpose: Confidence score + type (FULL/PARTIAL/NONE) matching Strava activity to plan activity
- Examples: `src/lib/integrations/strava-equivalence.ts`
- Pattern: Compare distance, duration, time-of-day; factor in pace consistency

## Entry Points

**Public Landing:**
- Location: `src/app/page.tsx`
- Triggers: Browser → `/`
- Responsibilities: Feature marketing, sign-in/sign-up CTAs

**Auth Resolution:**
- Location: `src/app/auth/resolve-role/page.tsx` (redirect target after Clerk signin)
- Triggers: Clerk callback
- Responsibilities: Sync user to DB, detect available roles, route to role home

**Athlete Dashboard:**
- Location: `src/app/dashboard/page.tsx`
- Triggers: Athlete user → `/dashboard` (from layout.tsx nav)
- Responsibilities: Show today's plan, log activities, display weekly summary

**Training Calendar:**
- Location: `src/app/calendar/page.tsx`
- Triggers: Athlete → `/calendar`
- Responsibilities: Show full plan week-by-week, select day to detail/log

**Plan Detail:**
- Location: `src/app/plans/[id]/page.tsx`
- Triggers: Athlete/Coach → `/plans/[id]`
- Responsibilities: Show plan overview, AI trainer chat, review/edit activities

**Coach Roster:**
- Location: `src/app/coach/page.tsx`
- Triggers: Coach → `/coach`
- Responsibilities: List assigned athletes, manage plan assignments

**PDF Upload:**
- Location: `src/app/upload/page.tsx` (POST to `src/app/api/plans/route.ts`)
- Triggers: Coach/Athlete → `/upload`
- Responsibilities: Form to select/drop PDF, trigger parse pipeline

## Error Handling

**Strategy:** Try-fail-log with graceful fallback; preserve audit trail in ParseJob

**Patterns:**

1. **Parse Failures:**
   - Catches in `POST /api/plans` and `POST /api/plans/[id]/reparse`
   - Logs to ParseJob.errorMessage
   - Returns 400/500 to frontend with user-friendly message
   - Plan remains in DRAFT; user can retry

2. **Strava Auth/Sync Failures:**
   - Catches in `/api/integrations/strava/*` routes
   - Logs to ExternalAccount.lastSyncAt + error context in response
   - Continues gracefully; activity list shows cached data

3. **Unit Conversion Errors:**
   - `unit-display.ts` functions return null if invalid
   - Components show raw value or fallback unit (MILES)

4. **Server Component Errors:**
   - Try-catch in pages; log error; show error boundary UI or empty state
   - Example: `src/app/calendar/page.tsx` catches prisma queries and shows fallback

## Cross-Cutting Concerns

**Logging:** `console.log`, `console.error` (Prisma logs on warn/error only)

**Validation:**
- OpenAI/Parser V4 JSON schema strict mode
- Clerk provides auth token validation
- Prisma enforces DB constraints

**Authentication:**
- Clerk middleware redirects unauthenticated users to `/sign-in`
- API routes check `currentUser()` and return 401
- Server components check role via `getCurrentUserRoleContext()`

**Authorization:**
- Plan ownership: `plan.ownerId === user.id || plan.athleteId === user.id`
- Coach roster: Verified via CoachAthlete join table
- Admin: Check `currentRole === ADMIN`

---

*Architecture analysis: 2025-02-24*
