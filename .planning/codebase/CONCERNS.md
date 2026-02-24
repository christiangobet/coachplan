# Codebase Concerns

**Analysis Date:** 2025-02-24

## Tech Debt

**Monolithic PDF Parsing Pipeline:**
- Issue: `src/app/api/plans/route.ts` (2357 lines) contains intertwined PDF parsing logic, data transformation, AI enrichment, and database operations all in a single POST handler.
- Files: `src/app/api/plans/route.ts`, `src/lib/ai-plan-parser.ts`, `src/lib/parsing/v4-to-plan.ts`
- Impact: Difficult to test, debug, and maintain. Changes to any parsing step risk breaking others. Error recovery is limited.
- Fix approach: Decompose into separate services: `PdfExtractionService`, `PlanParsingService`, `ActivityEnrichmentService`. Each handles one concern and can fail gracefully.

**Large Client Component with Manual State Sync:**
- Issue: `src/app/plans/[id]/review/page.tsx` (2426 lines) is a sprawling client component managing plan review UI with debounced saves, multiple timer refs for batch updates, and complex state management.
- Files: `src/app/plans/[id]/review/page.tsx`
- Impact: Hard to understand data flow, easy to introduce race conditions between UI and API, multiple timers can conflict, no centralized state management.
- Fix approach: Migrate to React Query for server state sync, extract form logic into separate hook (`usePlanDayEditor`, `useActivityEditor`), use proper form state management (React Hook Form).

**Unvalidated JSON Parsing:**
- Issue: Multiple places parse JSON from untrusted sources without try-catch or validation:
  - `src/lib/openai.ts:173`: `JSON.parse(stripJsonFences(text))`
  - `src/lib/ai-summary-extractor.ts:82`: `JSON.parse(cleaned)`
  - `src/app/plans/[id]/page.tsx:548`: `JSON.parse(text)` in client-side data loading
- Files: `src/lib/openai.ts`, `src/lib/ai-summary-extractor.ts`, `src/app/plans/[id]/page.tsx`
- Impact: Malformed AI responses or corrupted data can crash the app or expose errors to users.
- Fix approach: Wrap all `JSON.parse` in try-catch, validate structure with Zod/Yup before use, provide fallback empty values on parse failure.

**Loosely Typed Data Transformations:**
- Issue: Cast-heavy code using `as any` and unsafe type assertions:
  - `src/lib/clone-plan.ts:87`: `type: a.type as any`
  - `src/app/api/plans/route.ts:1612`: `(textContent.items as any[])`
  - `src/components/PlanSourcePdfPane.tsx:114`: `{ data: bytes } as any` for pdfjs
- Files: `src/lib/clone-plan.ts`, `src/app/api/plans/route.ts`, `src/components/PlanSourcePdfPane.tsx`, `src/lib/pdf/extract-text.ts`
- Impact: Silent type errors at runtime, data corruption when shape assumptions break (e.g., API changes).
- Fix approach: Define proper TypeScript interfaces for parsed data structures, use Zod for runtime validation of external API responses, eliminate `as any` casts.

## Known Bugs

**Parser Quality Threshold May Be Too Strict:**
- Issue: Plans fail to load if quality score < 30 or dayCoverage < 0.12 (`src/app/api/plans/route.ts:2164-2165`).
- Files: `src/app/api/plans/route.ts`, `src/lib/feature-flags.ts`
- Symptoms: Valid training plans get rejected with "Parsed content confidence too low" even if they parse correctly but PDF layout is unusual.
- Trigger: Uploads of PDFs with non-standard formatting, scanned plans, or plans with sparse text.
- Workaround: Manually lower `PARSE_MIN_QUALITY_SCORE` or `PARSE_MIN_DAY_COVERAGE` env vars, but this risks accepting garbage parses.

**AI Week Parse Budget Can Be Exceeded Without Warning:**
- Issue: When processing multi-week plans, the AI enrichment budget (`AI_WEEK_PARSE_TOTAL_BUDGET_MS`, default 30s) can be exhausted mid-plan without graceful degradation.
- Files: `src/app/api/plans/route.ts:2238-2240`
- Symptoms: Later weeks in a plan get no AI enrichment even though earlier weeks did; no indication to user.
- Trigger: Large plans (20+ weeks) with all weeks selected for AI parsing.
- Workaround: Lower `AI_WEEK_PARSE_MAX_DAYS` to reduce per-week AI load, or increase total budget.

**Missing Error Context in Activity Matching:**
- Issue: Strava activity matching (`src/lib/integrations/strava.ts:629`) evaluates equivalence but doesn't log mismatches or scoring details by default.
- Files: `src/lib/integrations/strava.ts`, `src/app/api/integrations/strava/match/route.ts`
- Symptoms: Users see activities marked "Not evaluated" or unmatched with no explanation; unclear why a Strava run didn't match a planned run.
- Trigger: Pace differences, sport type mismatches, or timing gaps between planned and actual.
- Workaround: Check database `ExternalActivity.equivalenceNote` field, but no UI to display it.

**Race Condition in Plan Review Saves:**
- Issue: Multiple debounced saves (`src/app/plans/[id]/review/page.tsx:873, 950`) for days and activities don't coordinate; if network is slow, a later save can overwrite an earlier one.
- Files: `src/app/plans/[id]/review/page.tsx`
- Symptoms: User edits day notes and activity pace, one save is still pending when they edit again; first edit loses race.
- Trigger: Fast edits followed by slow network, or switching between day and activity fields rapidly.
- Workaround: User must wait for "Saved" indicator before editing other fields.

## Security Considerations

**Environment Variable Sprawl:**
- Risk: Multiple integration points read `process.env` directly without validation:
  - Strava: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` (`src/lib/integrations/strava.ts:124-128`)
  - OpenAI: `OPENAI_API_KEY` (`src/lib/openai.ts:188`)
  - Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (`src/lib/openai.ts:208-209`)
  - Gemini: `GEMINI_API_KEY` (`src/lib/openai.ts:253`)
  - Integration state: `INTEGRATIONS_STATE_SECRET || CLERK_SECRET_KEY` (`src/lib/integrations/state.ts:11`)
- Files: `src/lib/openai.ts`, `src/lib/integrations/strava.ts`, `src/lib/integrations/state.ts`, `src/lib/ai-summary-extractor.ts`
- Current mitigation: Secrets are server-side only (not exposed in client bundles). Environment variables are checked for existence before use.
- Recommendations:
  1. Centralize env var reading into a validated config module (e.g., `src/lib/config.ts`) that validates all required keys on startup.
  2. Add explicit checks for missing keys and fail fast at server boot, not during request handling.
  3. Use a secrets management service (e.g., AWS Secrets Manager, Vercel KV) instead of env vars for sensitive keys.

**Strava State Token Signature Verification:**
- Risk: Integration state tokens use HMAC-SHA256 signature verification (`src/lib/integrations/state.ts:30-42`), but falling back to `CLERK_SECRET_KEY` as fallback is risky if Clerk key changes.
- Files: `src/lib/integrations/state.ts`
- Current mitigation: Signature check includes timing check (max age 15 minutes), so replay window is limited.
- Recommendations:
  1. Make `INTEGRATIONS_STATE_SECRET` mandatory and fail if missing.
  2. Add audit logging for state token validation failures.
  3. Consider using short-lived JWT tokens instead of custom state tokens.

**Unvalidated PDF Upload:**
- Risk: PDFs are uploaded and stored in database as `Bytes` without validation of file structure or size limits beyond form submission.
- Files: `src/app/api/plans/route.ts:2068-2094`, `prisma/schema.prisma:171`
- Current mitigation: NextRequest likely has size limits; pdfjs can handle malformed PDFs gracefully.
- Recommendations:
  1. Validate PDF structure early: check PDF magic bytes (`%PDF`), validate page count before storing.
  2. Set explicit size limit (e.g., 50MB max), reject larger files with clear error.
  3. Scan uploaded files for malware using a service (e.g., ClamAV) before storing.

**SQL Injection via Prisma:**
- Risk: None detected. All database queries use Prisma parameterized queries and type-safe client API.
- Mitigation: Prisma Client prevents injection by design; no raw SQL used in codebase.

## Performance Bottlenecks

**Unbounded PDF Text Extraction:**
- Problem: `src/app/api/plans/route.ts` extracts full PDF text for every page without streaming or pagination, then passes entire text to AI for plan guide extraction.
- Files: `src/app/api/plans/route.ts:2121`, `src/lib/ai-guide-extractor.ts`
- Cause: Large PDFs (200+ pages) can result in 100KB+ of text passed to AI model, slowing parse and increasing API costs.
- Improvement path:
  1. Sample first N pages for guide extraction instead of full text.
  2. Implement streaming PDF extraction to avoid loading entire file in memory.
  3. Cache extracted guides by PDF checksum to avoid re-parsing same PDF.

**Synchronous Activity Matching Loop:**
- Problem: `src/lib/integrations/strava.ts:629` evaluates equivalence for each Strava activity sequentially in a loop during sync.
- Files: `src/lib/integrations/strava.ts`, `src/app/api/integrations/strava/sync/route.ts`
- Cause: With 100+ Strava activities, sync takes minutes because each matching is sequential and involves database lookups.
- Improvement path:
  1. Batch activity candidate lookups into a single database query instead of per-activity.
  2. Move matching logic to parallel Promise.all() batch.
  3. Implement caching of candidate plans to avoid re-querying same plan.

**Large Component Renders Without Memoization:**
- Problem: `src/app/plans/[id]/review/page.tsx` re-renders entire plan review UI on every state change without proper component boundaries.
- Files: `src/app/plans/[id]/review/page.tsx`
- Cause: Parent component updates force re-renders of activity tables and day cards, even when their data didn't change.
- Improvement path:
  1. Break into smaller memoized components: `DayCard`, `ActivityRow`, `ReviewWeekSection`.
  2. Use `useMemo` and `useCallback` to stabilize references.
  3. Move data fetching to React Query hooks with selective refetching.

**Database Queries Without Pagination:**
- Problem: `src/app/calendar/page.tsx` loads all activities for a plan without pagination or lazy loading.
- Files: `src/app/calendar/page.tsx`
- Cause: Large plans with 500+ activities load all at once, slowing page load and hydration.
- Improvement path:
  1. Paginate activity queries by week or date range.
  2. Implement lazy-load for off-screen weeks.
  3. Use database indices on `(planId, weekId)` for faster queries.

## Fragile Areas

**Parser V4 / Legacy Parser Dual-Write Mode:**
- Files: `src/app/api/plans/route.ts:2096-2144`, `src/lib/feature-flags.ts`
- Why fragile: Dual-write mode (`PARSE_DUAL_WRITE`) runs both parser versions in parallel and requires careful handling of mismatches. If feature flags are misconfigured or both parsers return invalid data, plan creation fails silently.
- Safe modification:
  1. Always test both `PARSER_V4=true` and `PARSER_V4=false` in dev when changing parsing logic.
  2. Check feature flags explicitly before changing parser selection logic.
  3. Add structured logging to track which parser was used and quality scores.
- Test coverage: Parser selection logic (`selectBestParseCandidate`) lacks unit tests; integration tests needed.

**Strava Integration State Management:**
- Files: `src/lib/integrations/state.ts`, `src/app/api/integrations/strava/callback/route.ts`
- Why fragile: State token generation and verification uses cryptographic signing; rotation of `INTEGRATIONS_STATE_SECRET` will invalidate in-flight OAuth flows.
- Safe modification:
  1. Never rotate `INTEGRATIONS_STATE_SECRET` during business hours or peak usage.
  2. Implement grace period that accepts old key for 24 hours after rotation.
  3. Test callback flow end-to-end in staging before deploying.
- Test coverage: OAuth callback flow is not covered by automated tests; manual testing required.

**Plan Guide and Summary Extraction:**
- Files: `src/lib/ai-guide-extractor.ts`, `src/lib/ai-summary-extractor.ts`, `src/app/api/plans/route.ts`
- Why fragile: AI-driven extraction of plan guide and summary can return malformed JSON, incomplete data, or hallucinations. These failures are non-fatal (swallowed) but leave features broken.
- Safe modification:
  1. Wrap all AI calls in try-catch with structured logging of failures.
  2. Validate JSON response schema with Zod before storing.
  3. Provide fallback empty values for missing guide/summary fields.
- Test coverage: AI extraction is tested only against live OpenAI API; mocking not implemented.

**Activity Logging and Completion State:**
- Files: `src/components/DayLogCard.tsx`, `src/app/api/plan-days/[id]/complete/route.ts`, `src/lib/day-status.ts`
- Why fragile: Activity completion state is split between client UI (`completed` boolean) and API logic (marking day as done). Inconsistent state can lead to UI showing activity as done but API not acknowledging it, or vice versa.
- Safe modification:
  1. Always fetch fresh state from server before rendering completion buttons.
  2. Optimistically update UI only after server confirms save.
  3. Implement conflict resolution if concurrent edits are possible.
- Test coverage: Completion state transitions are tested but concurrent edit scenarios are not.

## Scaling Limits

**PDF Storage in Database:**
- Current capacity: PDF files stored as `Bytes` in `PlanSourceDocument.content` field.
- Limit: PostgreSQL column size is limited; storing large PDFs (50MB+) will cause database bloat and slow queries.
- Scaling path:
  1. Migrate PDF storage to S3 or similar object store; store URL in database.
  2. Implement tiered storage: keep recent PDFs in DB, archive old ones to cold storage.
  3. Compress PDFs before storage to reduce database size.

**Strava Activity Sync per User:**
- Current capacity: Sync loop fetches all activities since last sync and matches each against plan candidates.
- Limit: With 1000+ athletes and 10,000+ total Strava activities, sequential matching becomes slow (O(n*m) complexity).
- Scaling path:
  1. Implement activity matching in batch using bulk database operations.
  2. Add background job queue (e.g., Bull) for async Strava syncs instead of synchronous API calls.
  3. Cache matched activities to avoid re-scoring on subsequent syncs.
  4. Add database indices on `(userId, provider, providerActivityId)` for fast lookups.

**Plan Review Page Load:**
- Current capacity: Page loads all weeks and activities for a plan at once in a single server component fetch.
- Limit: Plans with 50+ weeks and 500+ activities take 3-5 seconds to load and hydrate.
- Scaling path:
  1. Paginate activities by week; load only visible weeks initially.
  2. Implement React Query with infinite scroll for activity list.
  3. Move data fetching to the edge (Vercel KV) to cache plan metadata.
  4. Add database indices on `(planId, weekId)` for faster queries.

## Dependencies at Risk

**pdfjs-dist with Custom Worker:**
- Risk: pdfjs-dist is loaded with custom worker path via file URL (`pathToFileURL`), which is fragile to Node.js version changes and deployment environment differences.
- Impact: PDF parsing can fail silently in certain deployment environments (e.g., serverless functions with restricted file system access).
- Migration plan:
  1. Use `pdfjs-dist` npm package worker instead of custom path.
  2. Test PDF extraction in staging deployment before production rollout.
  3. Add fallback to pure JavaScript parser if worker fails.

**OpenAI Model Versions:**
- Risk: Hardcoded model names (`gpt-4o-mini`, `gpt-4-turbo`) in environment variables. Model deprecation or pricing changes can break plan parsing.
- Impact: If OpenAI discontinues a model, all plan parsing fails until env var is updated.
- Migration plan:
  1. Implement model version checking on startup.
  2. Add fallback model list in case primary model becomes unavailable.
  3. Monitor OpenAI deprecation announcements and update model names proactively.

**Prisma Client Generation:**
- Risk: Prisma client must be regenerated after schema changes; forgetting this step causes runtime errors.
- Impact: Developers may commit schema changes without regenerating client, breaking CI/CD.
- Migration plan:
  1. Add pre-commit hook to enforce `prisma generate`.
  2. Add build step that validates Prisma client is up-to-date with schema.

## Missing Critical Features

**Plan Reconciliation After Strava Sync:**
- Problem: Strava activities are matched to plan activities, but there's no rollback or conflict resolution if a match later turns out to be wrong.
- Blocks: Users cannot easily un-match or re-match an activity after sync.

**Audit Trail for Plan Changes:**
- Problem: Plan edits (via review page) are not logged; no way to see who changed what and when.
- Blocks: Coaches cannot track athlete modifications to plans; compliance requirements cannot be met.

**Batch Operations for Plan Management:**
- Problem: Plans can only be archived or deleted one at a time via UI; no bulk operations.
- Blocks: Coaches with 100+ plans cannot efficiently manage them.

## Test Coverage Gaps

**PDF Parsing Quality Scoring:**
- What's not tested: `scoreParsedResult()` function in `src/app/api/plans/route.ts:202-280` is not unit tested; quality thresholds are magic numbers.
- Files: `src/app/api/plans/route.ts`
- Risk: Quality score formula changes can silently degrade parsing acceptance without detection.
- Priority: Medium

**Strava OAuth Callback Flow:**
- What's not tested: Full OAuth callback handling (`src/app/api/integrations/strava/callback/route.ts`) is not automated; manual testing only.
- Files: `src/app/api/integrations/strava/callback/route.ts`
- Risk: OAuth integration can break without detection; users cannot authenticate with Strava.
- Priority: High

**Plan Review Page State Consistency:**
- What's not tested: Concurrent edits to day and activity data in `src/app/plans/[id]/review/page.tsx` are not tested; race conditions possible.
- Files: `src/app/plans/[id]/review/page.tsx`
- Risk: Data loss or inconsistency under concurrent editing.
- Priority: High

**AI Enrichment Timeout Handling:**
- What's not tested: Timeout behavior in `src/app/api/plans/route.ts` when AI parsing exceeds budget is not tested.
- Files: `src/app/api/plans/route.ts`
- Risk: Plans fail to load silently if AI budget is exhausted.
- Priority: Medium

**Activity Matching Equivalence Evaluation:**
- What's not tested: `evaluateStravaEquivalence()` in `src/lib/integrations/strava-equivalence.ts` is not unit tested with various pace and distance mismatches.
- Files: `src/lib/integrations/strava-equivalence.ts`
- Risk: Activity matching produces incorrect results without detection.
- Priority: Medium

---

*Concerns audit: 2025-02-24*
