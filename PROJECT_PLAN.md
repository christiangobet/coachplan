# MyTrainingPlan — Implementation Status & Handover

> Last updated: 2026-04-06
> Scope: status synced to current codebase implementation

---

## ACTIVE STATUS — Markdown-native parser migration complete (2026-04-06)

> The chunked whole-plan AI parse bottleneck has been eliminated.
> The pipeline now uses a deterministic markdown-first path as the primary route.

### What changed

The old parse path was:
```
EXTRACTED_MD → gpt-4o-mini chunks (4 calls, batched) → ProgramJsonV1 → DB
```
Each chunk took >60s on `gpt-4o-mini`, causing the entire pipeline to timeout at the 290s wall.

The new parse path is:
```
EXTRACTED_MD → markdown-program-parser (deterministic, ~1ms) → optional per-session enrichment → ProgramJsonV1 → DB
```

AI is now only invoked for individual sessions that need enrichment (steps, coaching notes),
not for whole-week structural parsing. This eliminates the timeout entirely.

### Key files in the new path

| File | Role |
|------|------|
| `src/lib/parsing/markdown-program-parser.ts` | Deterministic week/table/session parser; converts EXTRACTED_MD → ProgramJsonV1 skeleton |
| `src/lib/parsing/markdown-session-enricher.ts` | Narrow per-session AI enrichment (steps, session_role, coaching_note); optional |
| `src/lib/ai-plan-parser.ts` | Wires EXTRACTED_MD into the deterministic parser; enrichment optional; validation/completeness/persistence unchanged |
| `src/lib/parsing/markdown-upload-enforcement.ts` | Upload guardrails: rejects partial, missing, or invalid programs |
| `src/lib/parsing/program-week-completeness.ts` | Week-level completeness check; used by both `populatePlanFromV4` and `evaluateMarkdownFirstUpload` |

### Test coverage (36 tests, all passing)

```bash
node --test --experimental-transform-types \
  scripts/markdown-program-parser.test.ts \
  scripts/markdown-first-budget.test.ts \
  scripts/program-week-completeness.test.ts \
  scripts/markdown-upload-enforcement.test.ts \
  scripts/upload-page-async-ui.test.ts \
  scripts/plan-parse-context.test.ts \
  scripts/review-guide-ui.test.ts
```

### Remaining follow-up work (backlog)

1. **Richer rule coverage** — The deterministic parser handles the most common session patterns (easy run, tempo, long run, intervals, rest). Plans using unusual notation (e.g. pace zones as `Z2`, structured intervals like `6×800m`) will produce sessions with `raw_text` preserved but minimal extracted fields. Session enrichment fills the gap via AI but broader rule coverage reduces AI calls.

2. **Shrink or cache enrichment calls** — `markdown-session-enricher.ts` currently calls the AI for every session that doesn't have fully deterministic fields. Caching by session hash or tightening the enrichment trigger would reduce cost and latency.

3. **Dead chunk-budget code cleanup** — `ai-plan-parser.ts` still contains the old chunked MD parse infrastructure (`chunkMd`, `VISION_PARSE_BUDGET_MS`, batch/concurrency logic). This is now a dead code path for the primary EXTRACTED_MD route. It can be removed in a cleanup pass once the new path has been validated in production.

4. **Production validation** — Run a real PDF upload end-to-end to confirm the new path completes within the 290s wall without hitting the old timeout. Look for:
   ```
   [MarkdownParser] parsed N weeks deterministically
   [UploadParser] Orchestrated parse complete { finalParser: 'vision', resultKind: 'program' }
   ```

---

---

## 1) Product snapshot

MyTrainingPlan converts training plans (PDF or templates) into structured execution workflows for athletes and coaches.

Current end-to-end flow:
1. Upload PDF to create a `DRAFT` plan.
2. Review and correct parsing output in `/plans/[id]/review`.
3. Activate plan with scheduling mode (`RACE_DATE` or `START_DATE`).
4. Execute day-by-day on dashboard/calendar/plan view.
5. Import Strava activity data to populate logged actuals.

---

## 2) What is implemented now

### Platform and architecture
- Next.js 16 + React 19 + TypeScript.
- Prisma schema includes role, plan, activity, and external integration models.
- Clerk auth with role resolution and retry-safe `/auth/resolve-role` flow.
- Middleware/proxy is in `src/proxy.ts`.

### Role and navigation model
- Roles: `ATHLETE`, `COACH`, `ADMIN`.
- Athlete default surfaces: `/dashboard`, `/calendar`, `/plans`, `/strava`, `/progress`, `/profile`.
- Role-specific nav in layout/header.
- Multi-role users can switch via `/select-role`.

### Plan lifecycle and scheduling
- Plan statuses: `DRAFT`, `ACTIVE`, `ARCHIVED`.
- Activation enforces scheduling mode:
  - `weekDateAnchor = RACE_DATE` requires `raceDate`.
  - `weekDateAnchor = START_DATE` requires `startDate`.
- Scheduling mode is applied at activation/active transitions; draft review remains unscheduled/editable.

### Parsing and review
- Upload route supports parser orchestration and quality scoring.
- v4 parser supports full-text pass strategy and week coverage handling.
- Plan guide extraction and summary surfaces are integrated.
- Review screen supports day/activity correction, reparsing, and session instruction workflows.

### Execution and logging UX
- Session-flow pattern is available in logging contexts.
- Planned vs logged actuals are kept separate (`distance/duration` vs `actualDistance/actualDuration`).
- Compact distance rendering prefers one decimal.
- Day status supports `OPEN`, `DONE`, `PARTIAL`, `MISSED` via notes tags + completion logic.

### Strava integration
- Connect/callback/sync/review/import routes implemented.
- Match/import supports session grouping and proportional handling for grouped sessions.
- Import/review appears in `/strava` and day-level context.

### Garmin integration
- API stubs exist, but connect/sync currently return `501 NOT_CONFIGURED`.

### Branding and landing
- Brand component (`BrandLogo`) introduced.
- Uses:
  - `public/branding/mytrainingplan-logo-full.png`
  - `public/branding/mytrainingplan-logo-mark.png`
- Landing and app chrome now use MyTrainingPlan branding.

### Responsive layout status
- Dashboard uses 3 -> 2 -> 1 behavior by breakpoint.
- Calendar, plan view, and strava pages have dedicated responsive behavior and mobile adaptations.
- Mobile navigation is present; iPhone-width behavior has targeted fixes for day panels and cards.

### AI trainer (coach conversation)
- Conversation history is persisted and displayed in the coach panel.
- Compact mobile FAB opens a full-screen conversation sheet.
- Intent routing distinguishes plan-modification proposals from general chat.
- Proposal integrity: AI responses that attempt to modify plans are validated before applying.

### Strava route sheets
- OpenStreetMap inline map rendering is embedded in plan day panels and daily log views.
- Route metadata (distance, elevation, polyline) is fetched and cached from Strava activities.

### UTC-safe date operations
- All calendar date math now uses UTC operations throughout.
- Fixes a 1-day shift bug on production where server timezone caused off-by-one in plan-day alignment.

### iOS/UX pass
- Calendar day columns widened for iPhone viewports.
- Tap targets audited and enlarged across key interactive elements.
- Mobile nav added to public-facing routes.
- Keyboard compact sheet: input fields no longer obscured by software keyboard on iOS.

### Performance
- Two-stage plan fetch on dashboard and progress pages: metadata loads first, day-level data deferred.

### Athlete beta flow
- Polished onboarding experience for athlete beta users.
- Audit workflow implemented for reviewing athlete plan usage.

---

## 3) Current UI layout model (as coded)

### Dashboard (`dash-grid`)
- Large desktop: left + center + right columns.
- <=1380px: left + center (right hidden).
- <=768px: single column with side panels hidden.

### Calendar (`/calendar`)
- Base desktop: left + center.
- Desktop when day selected (`.cal-day-open`): right day panel column is shown.
- <=900px: single column; left sidebar hidden.

### Plan view (`/plans/[id]`)
- Base desktop: left + main.
- Day panel is a right fixed panel that opens when a day is selected.
- <=900px: day panel becomes full-screen style overlay panel.

### Strava (`/strava`)
- Desktop: left + center.
- <=900px: single column, with inline mobile sync panel.

---

## 4) API surface (high-level)

### Plans
- `/api/plans` (create/upload/parse)
- `/api/plans/[id]` (read/update/delete with scheduling constraints)
- `/api/plans/[id]/publish`
- `/api/plans/[id]/review/*`
- `/api/plans/from-template`
- `/api/plans/[id]/source-document/*`

### Activities and day completion
- `/api/activities/[id]/toggle`
- `/api/activities/[id]/complete`
- `/api/activities/[id]/actuals`
- `/api/plan-days/[id]/complete`

### Integrations
- `/api/integrations/accounts`
- Strava: connect/callback/sync/review/import/match/webhook
- Garmin: connect/sync (not configured)

### Role surfaces
- Coach: templates/athletes/assign flows under `/api/coach/*`
- Admin: parser prompts, users, stats under `/api/admin/*`

---

## 5) Known gaps / active backlog

1. Garmin production integration (credentials + end-to-end flow).
2. Further cleanup of cross-page responsive consistency for complex side panels.
3. Expanded analytics in progress view (planned vs logged trend depth).
4. Coach-to-athlete feedback loop depth and moderation/audit tooling.

---

## 6) Verification baseline for handovers

Run before claiming a stable handover:

```bash
npm run typecheck
npm run verify
```

If docs changed:

```bash
git status --short -- '*.md'
```

---

## 7) Documentation rule

When behavior changes in routes/layout/flows:
- update `README.md` (setup + user flow)
- update `CLAUDE.md` (developer quick context)
- update this file (`PROJECT_PLAN.md`) with concrete implementation state
- update `CONVENTIONS.md` when breakpoints/layout patterns change
