# External Integrations

**Analysis Date:** 2026-02-24

## APIs & External Services

**Activity Sync & Tracking:**
- Strava - Athlete activity import and workout matching
  - SDK/Client: Strava REST API (no SDK, raw fetch)
  - Implementation: `src/lib/integrations/strava.ts` (50KB, comprehensive)
  - Auth: OAuth 2.0 via Clerk
  - Env vars: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
  - Endpoints:
    - Connect: `/api/integrations/strava/connect` (initiates OAuth flow)
    - Callback: `/api/integrations/strava/callback` (receives OAuth token)
    - Sync: `/api/integrations/strava/sync` (fetch activities since last sync)
    - Import Day: `/api/integrations/strava/import-day` (import activities for specific date)
    - Match: `/api/integrations/strava/match` (assign Strava activity to plan activity)
    - Review: `/api/integrations/strava/review` (review matched activities)

- Garmin - Activity import (partial implementation)
  - Implementation: `src/app/api/integrations/garmin/sync/route.ts`, `connect/route.ts`
  - Auth: OAuth 2.0 (not yet fully configured)
  - Env vars: `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET`
  - Status: Basic connect/sync routes exist, full sync logic not implemented

**AI & Language Models:**
- OpenAI API (default) - PDF plan parsing and content extraction
  - Model: `gpt-4o-mini` (default, configurable via `OPENAI_MODEL`)
  - Implementation: `src/lib/openai.ts` (abstraction for multiple providers)
  - Auth: Bearer token via `OPENAI_API_KEY`
  - Endpoints:
    - `https://api.openai.com/v1/responses` - Structured JSON output (responses API)
  - Used for:
    - Plan document parsing: `src/lib/ai-plan-parser.ts`
    - Guide extraction: `src/lib/ai-guide-extractor.ts`
    - Summary extraction: `src/lib/ai-summary-extractor.ts`

- Cloudflare Workers AI (alternate provider) - Drop-in replacement for OpenAI
  - Model: `@cf/openai/gpt-oss-20b` (configurable via `CLOUDFLARE_AI_MODEL`)
  - Enable via: `AI_PROVIDER=cloudflare`
  - Auth: Bearer token via `CLOUDFLARE_API_TOKEN`
  - Account: `CLOUDFLARE_ACCOUNT_ID`
  - Endpoint: `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/responses`
  - Provider abstraction in `src/lib/openai.ts` handles schema format differences

- Google Gemini (alternate provider) - Drop-in replacement for OpenAI
  - Model: `gemini-2.0-flash` (configurable via `GEMINI_MODEL`)
  - Enable via: `AI_PROVIDER=gemini`
  - Auth: API key via `GEMINI_API_KEY`
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  - Provider abstraction handles response format differences and schema fallback

## Data Storage

**Databases:**
- PostgreSQL (primary)
  - Connection: `DATABASE_URL`
  - Client: Prisma ORM 5.22.0
  - Schema: `prisma/schema.prisma`
  - Models: User, TrainingPlan, PlanWeek, PlanDay, PlanActivity, ExternalAccount, ExternalActivity, ParseJob, ParseArtifact, etc.

**File Storage:**
- PostgreSQL BYTEA column for PDF storage
  - Model: `PlanSourceDocument` in `prisma/schema.prisma`
  - Stores full PDF file content with metadata (fileSize, checksumSha256, pageCount)
  - Location: `src/app/api/plans/[id]/source-document/route.ts` (GET), `file/route.ts` (download)

**Caching:**
- No external caching service detected
- In-memory caching via Prisma client (development mode uses global singleton in `src/lib/prisma.ts`)

## Authentication & Identity

**Auth Provider:**
- Clerk - Complete authentication platform
  - Implementation: `@clerk/nextjs` 6.37.2
  - Middleware: `src/middleware.ts` (protects routes via Clerk)
  - Server components: `currentUser()` for user context
  - API routes: `auth()` for user context, `requireRoleApi()` for role guards
  - Features:
    - Multi-factor auth support (via Clerk)
    - OAuth integration (Strava, Garmin, and built-in social providers)
    - Session management
    - User impersonation for debugging

**Role & Permission System:**
- Custom roles in database: ATHLETE, COACH, ADMIN
  - Stored in `User.role` and `User.currentRole` (allows role switching)
  - Guards: `src/lib/role-guards.ts` (requireRoleApi, requireRoleServer)

**OAuth Integration:**
- Strava OAuth 2.0
  - Flow via Clerk + custom state token
  - State token: HMAC-signed via `src/lib/integrations/state.ts`
  - Storage: `ExternalAccount` model in database
  - Token refresh: Automatic (Strava tokens expire in 6 hours)

- Garmin OAuth 2.0 (partial)
  - Endpoints exist but full implementation pending

## Monitoring & Observability

**Error Tracking:**
- Sentry - Not detected in dependencies
- Custom error logging via console and Prisma logs

**Logs:**
- Prisma logging: Errors and warnings only (configured in `src/lib/prisma.ts`)
- Console logging in API routes and utilities (no structured logging framework)
- Vercel built-in logging for deployment

## CI/CD & Deployment

**Hosting:**
- Vercel (inferred from Next.js setup and turbopack configuration)
  - Output file tracing configured in `next.config.ts`
  - Serverless function compatibility ensured for PDF worker

**CI Pipeline:**
- None detected in repository
- ESLint runs locally: `npm run lint`
- Build verification: `npm run verify` (type check + build)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection
- `CLERK_SECRET_KEY` - Clerk API secret
- One AI provider (default OpenAI):
  - `OPENAI_API_KEY` (or Cloudflare/Gemini equivalent)
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` - For Strava integration

**Secrets location:**
- `.env.local` (development) - Not committed
- Environment secrets manager (Vercel, etc.)
- Never stored in code or version control

## Webhooks & Callbacks

**Incoming:**
- Strava OAuth callback: `/api/integrations/strava/callback`
  - Receives authorization code from Strava
  - Exchanges code for access token
  - Stores token in `ExternalAccount` model

- Garmin OAuth callback (placeholder): `/api/integrations/garmin/*`
  - Implementation pending

**Outgoing:**
- None detected
- Future: Strava activity webhooks could be implemented (not currently enabled)

## Integration Flow Examples

**Strava Sync:**
1. User initiates connect: `/api/integrations/strava/connect`
2. Redirects to Strava OAuth authorize URL
3. User approves on Strava
4. Strava redirects to `/api/integrations/strava/callback` with auth code
5. App exchanges code for access/refresh tokens
6. Stores in `ExternalAccount` with `provider=STRAVA`
7. User clicks sync: `/api/integrations/strava/sync`
8. Fetches activities from `https://www.strava.com/api/v3/athlete/activities`
9. Stores in `ExternalActivity` model with equivalence scoring
10. User reviews and matches via `/api/integrations/strava/match`

**AI Plan Parsing:**
1. User uploads PDF plan
2. API stores in `PlanSourceDocument` (BYTEA column)
3. Extracts text via `src/lib/pdf/extract-text.ts` (pdfjs-dist)
4. Sends to AI provider (OpenAI/Cloudflare/Gemini) with structured JSON schema
5. AI parses into plan structure (weeks, days, activities)
6. Stores in `TrainingPlan`, `PlanWeek`, `PlanDay`, `PlanActivity` models
7. Optional: Extract guide via `/api/plans/[id]/extract-guide` (session instructions)
8. Athlete reviews and confirms

## Security Considerations

**OAuth State Protection:**
- State tokens use HMAC-SHA256 signing
- Implementation: `src/lib/integrations/state.ts`
- Fallback to `CLERK_SECRET_KEY` if `INTEGRATIONS_STATE_SECRET` not set

**Database Credentials:**
- Stored only in environment variables
- Prisma client handles connection pooling

**API Keys:**
- All API keys (OpenAI, Strava, etc.) stored in environment variables
- No hardcoded secrets
- Clerk handles sensitive token storage

**Token Refresh:**
- Strava tokens automatically refreshed on sync
- Tokens stored encrypted in database (via Prisma + host encryption)

---

*Integration audit: 2026-02-24*
