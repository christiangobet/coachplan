# Technology Stack

**Analysis Date:** 2026-02-24

## Languages

**Primary:**
- TypeScript 5 - Full codebase (server components, API routes, utilities)
- JavaScript - Node.js utilities and build scripts (`.mjs`, `.js` files in `scripts/`)

**Secondary:**
- Python 3 - PDF text extraction via legacy `scripts/parse_plan_pdf.py` (pdfplumber-based)
- CSS - Component styling

## Runtime

**Environment:**
- Node.js 22.x (enforced in `package.json#engines`)
- npm >= 10 (enforced in `package.json#engines`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (standard npm lockfile)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack framework (App Router, server components, API routes)
  - Turbopack configured for faster builds
  - Configured in `next.config.ts`

**UI:**
- React 19.2.3 - Component library
- React DOM 19.2.3 - DOM rendering

**Database:**
- Prisma 5.22.0 - ORM for PostgreSQL
  - Client: `@prisma/client` 5.22.0
  - Migrations stored in `prisma/migrations/`
  - Schema: `prisma/schema.prisma`

**AI/Parsing:**
- OpenAI API (gpt-4o-mini by default) - Plan parsing via structured JSON output
  - Fallback support for Cloudflare AI and Google Gemini via provider abstraction
  - Configured via `src/lib/openai.ts`

**Testing/Auditing:**
- Playwright 1.58.2 - Visual regression and E2E testing
  - Scripts: `npm run audit:screens`, `npm run audit:screens:manual`
  - Output tracking for Vercel deployment

**Build/Dev:**
- ESLint 9 - Code linting
- ESLint Config (Next.js) 16.1.6 - Next.js linting preset

## Key Dependencies

**Critical:**
- `@clerk/nextjs` 6.37.2 - Authentication and user management
  - Provides `auth()` middleware for API routes
  - Provides `currentUser()` for server components
  - OAuth integration with Strava and Garmin

- `@prisma/client` 5.22.0 - Database client (ORM)
  - Singleton pattern via `src/lib/prisma.ts`
  - Logging configured for errors and warnings only

**Infrastructure:**
- `pdfjs-dist` 4.10.38 - Client-side PDF text extraction (used in API routes)
  - Legacy build included in Turbopack output tracing
  - Configured in `next.config.ts` for Vercel serverless compatibility

- `pdf-parse` 1.1.1 - Alternative PDF parsing utility (legacy, may be superseded by pdfjs-dist)

## Configuration

**Environment:**

Core variables (must be set):
- `DATABASE_URL` - PostgreSQL connection string
- `CLERK_SECRET_KEY` - Clerk API secret
- `CLERK_PUBLISHABLE_KEY` - Public clerk key (prefixed `NEXT_PUBLIC_`)
- `OPENAI_API_KEY` - OpenAI API key (if using OpenAI provider)

AI Provider switching (choose one):
- **OpenAI (default):**
  - `OPENAI_API_KEY` - Required
  - `OPENAI_MODEL` - Optional, defaults to `gpt-4o-mini`

- **Cloudflare Workers AI:**
  - `AI_PROVIDER=cloudflare`
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_AI_MODEL` - Optional, defaults to `@cf/openai/gpt-oss-20b`

- **Google Gemini:**
  - `AI_PROVIDER=gemini`
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL` - Optional, defaults to `gemini-2.0-flash`

Third-party integrations:
- `STRAVA_CLIENT_ID` - Strava OAuth client ID
- `STRAVA_CLIENT_SECRET` - Strava OAuth client secret
- `GARMIN_CLIENT_ID` - Garmin OAuth client ID (partial implementation)
- `GARMIN_CLIENT_SECRET` - Garmin OAuth client secret (partial implementation)

Security:
- `INTEGRATIONS_STATE_SECRET` - HMAC secret for OAuth state tokens (falls back to `CLERK_SECRET_KEY`)

Optional Clerk configuration (auto-configured via `@clerk/nextjs`):
- `NEXT_PUBLIC_CLERK_DOMAIN` - Clerk hosted UI domain
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` - Redirect after signin (default: `/dashboard`)
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` - Redirect after signup (default: `/`)

**Build:**
- `tsconfig.json` - TypeScript compilation config
  - Target: ES2017
  - Module resolution: bundler (Next.js managed)
  - Path alias: `@/*` → `./src/*`
  - Strict mode enabled

- `next.config.ts` - Next.js configuration
  - Turbopack enabled with project root tracking
  - Output file tracing includes `pdfjs-dist/legacy/build/pdf.worker.mjs` for serverless compatibility

## Platform Requirements

**Development:**
- Node.js 22.x
- npm >= 10
- PostgreSQL database (local or remote)
- Clerk account + API keys
- OpenAI / Cloudflare / Gemini API account (one required)

**Production:**
- Vercel (implied by Next.js deployment; Turbopack and output tracing configured)
- PostgreSQL database
- Clerk account (OAuth configuration)
- AI provider account (OpenAI, Cloudflare, or Gemini)
- Strava OAuth app credentials (optional, for integrations)
- Garmin OAuth app credentials (optional, partial support)

## Dependency Management

**Postinstall Hook:**
- `npm run postinstall` automatically runs `prisma generate` to regenerate Prisma client after install

**Development Commands:**
- `npm run dev` - Start dev server on port 3001 with Prisma client generation
- `npm run build` - Full production build (Prisma generate + Next.js build)
- `npm run typecheck` - TypeScript type checking without emit
- `npm run verify` - Full CI verification (Prisma generate + type check + build)

---

*Stack analysis: 2026-02-24*
