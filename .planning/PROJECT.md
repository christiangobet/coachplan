# CoachPlan

## What This Is

CoachPlan is a training plan management app for endurance athletes. Athletes upload a PDF training plan, which is parsed and structured into a week-by-week schedule. They activate it against a race date or start date, then track daily workouts and log completed activities. Strava sync allows matching real activities to planned ones.

## Core Value

An athlete opens the app on their iPhone and immediately knows what to do today, how far they are through their plan, and how their actual training compares to what was planned.

## Requirements

### Validated

- ✓ PDF upload → AI parse → structured plan (TrainingPlan → PlanWeek → PlanDay → PlanActivity)
- ✓ Plan activation with RACE_DATE or START_DATE scheduling modes
- ✓ Strava OAuth connect → sync → match → import activities
- ✓ Push notifications (fully implemented)
- ✓ Plan editing UI (desktop/iPad)
- ✓ Daily workout logging
- ✓ Coach chat / AI plan editing (exists but needs improvement)

### Active

- [ ] Unified daily view: today's workout + week X of Y + progress vs plan
- [ ] Clear screen hierarchy: eliminate overlap between dashboard / calendar / plan view
- [ ] Mobile calendar: less cramped, better breathing room on iPhone
- [ ] Coach chat UX: fix bugs, clarify AI capabilities, integrate into experience naturally
- [ ] Setup flow reliability: upload → parse → correct → activate must be rock-solid on desktop/iPad
- [ ] Beta-ready onboarding: a new athlete can get up and running without handholding

### Out of Scope

- Garmin integration — partner credentials not available; returns 501
- Native iOS/Android app — web-first, PWA sufficient for v1 beta
- Coach-side dashboard (managing multiple athletes) — deferred to v2
- Social/community features — not core to v1 value
- AI plan generation from scratch — editing existing plans is sufficient for v1

## Context

- **Two usage modes**: Desktop/iPad for setup (upload, parse, correct, activate); iPhone for daily execution (log, track, view progress)
- **Target users**: Small beta group of endurance athletes known personally
- **Stack**: Next.js 16 + React 19 + TypeScript, Prisma/PostgreSQL, Clerk auth, Anthropic/OpenAI for AI features, deployed on Vercel
- **Local dev**: Runs on port 3001
- **Apple-first**: macOS + iOS Safari; apply iOS Safari quirks (dvh, 16px inputs, safe-area) to all UI
- **Design system**: `design-system/coachplan/MASTER.md` — tokens, dark mode, iOS quirks, anti-patterns
- **Codebase map**: `.planning/codebase/` — architecture, conventions, concerns already documented

## Constraints

- **Tech stack**: Next.js / Prisma / Clerk — no framework changes
- **Platform**: iOS Safari as primary mobile target — dvh, safe-area, 16px input minimum
- **Deployment**: Vercel — serverless constraints apply (PDF worker, edge runtime limits)
- **Auth**: Clerk handles all auth — do not introduce parallel session systems

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web app (not native) | Faster iteration, PWA sufficient for beta | — Pending |
| AI via provider abstraction | Flexibility to swap OpenAI/Cloudflare/Gemini | ✓ Good |
| Clerk for auth | OAuth + social login without building it | ✓ Good |
| Strava before Garmin | Strava has OAuth ready; Garmin needs partner credentials | ✓ Good |

---
*Last updated: 2026-03-27 after initial project initialization*
