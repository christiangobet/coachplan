# CoachPlan — Project Plan

> **Last updated:** 2026-02-14 (Production go-live baseline: Vercel + Clerk + Neon live, auth loop fixed, upload parse flow hardened)
> **IMPORTANT:** Codex must update this file at the end of every session (progress %, status labels, and next actions).

---

## A. Product Goal

CoachPlan is a training-plan execution platform for athletes, coaches, and admins.
Primary objective: convert plan templates/PDFs into date-aligned training plans, then execute daily with clear actual-vs-planned tracking.

### Core User Flows
1. Upload/import template or PDF plan
2. Align plan to race date
3. Execute daily workouts from dashboard/calendar
4. Sync Strava activities and import actuals into plan logs
5. Track completion/progress and coach oversight

### Tech Stack
- Next.js 16 (App Router) + TypeScript
- Clerk auth + PostgreSQL + Prisma
- OpenAI parsing (gpt-4o-mini) + Python/pdfplumber for PDFs
- Production hosting: Vercel + Neon Postgres

---

## B. Current System Logic (Authoritative)

### Roles and Access
- Three environments/roles: `ATHLETE`, `COACH`, `ADMIN`
- If a user has multiple roles, login/session flow prompts role selection
- Protected route guards enforce role context (`/dashboard`, `/coach`, `/admin`)
- Admin bootstrap command: `npm run make-admin -- <email>`

### Plan and Race Model
- Athlete trains for a specific race/goal using a plan cloned from template/source
- Template key feature is length/structure; assigned plan carries date alignment
- Plan weeks/days are aligned from race date backward if explicit week dates are missing
- Displayed plan name prefers source/template filename when applicable

### Dashboard Logic
- Today/Next Up are date-aligned to plan window (not just week index)
- Pre-start mode shows weeks/days until training start
- Left column includes Strava sync controls
- Middle includes day-by-day Strava import table
- Right column status reflects recent day-level done/pending states

### Strava Sync and Import Logic
- Strava account is athlete-specific per logged-in user
- Sync window: **plan start date -> today** for dashboard sync actions
- Comparison table rows are by day:
  - Date
  - Plan activities for date
  - Strava activities for same date
  - Row action: `Import` / `Re-import` / `Done`
- Import behavior:
  - Matches same-day Strava entries to same-day plan activities
  - Writes actuals to plan activity log (`completed`, `completedAt`, `actualDistance`, `actualDuration`, `actualPace`, notes)
  - Uses fallback matching if strict type match is weak but day-level mapping is clear

### Calendar Logic
- Calendar is month view aligned to training dates
- Clicking a day opens detailed day context in right panel
- Day details include planned activities, logged actuals, and external logs for that day
- Manual day completion supported via `PlanDay.notes` marker (`[DAY_DONE]`)
- Day completion reflects in dashboard status cards

### Race Detail Editing Flow
- Canonical location: `/calendar` -> Selected Plan card -> `Edit race details`
- Plan detail page focuses on workout execution

### Production/Runtime Guardrails
- Vercel build forces Prisma generation (`prisma generate && next build`)
- Middleware is hardened to fail-open if Clerk runtime context fails
- User sync no longer rewrites `User.id` on email match (prevents sign-in -> resolve-role loop)
- Upload parsing writes temp files to `/tmp`, applies parser timeout, and returns explicit parse errors
- AI week parse is disabled by default in upload path (`ENABLE_AI_WEEK_PARSE=true` to enable)

---

## C. Implementation Stages

### Stage 1: Foundation (DONE)
- [x] Next.js app + Clerk auth + Prisma/Postgres
- [x] User/plan/week/day/activity data model
- [x] Upload + parse pipeline
- [x] Plan review flow

### Stage 2: UI Redesign (DONE)
- [x] Strava-inspired visual system
- [x] Dashboard redesign
- [x] Plan list/detail visual redesign

### Stage 3: Workout Tracking (DONE)
- [x] Complete/uncomplete workout
- [x] Actuals logging (distance/duration/pace)
- [x] Activity detail modal

### Stage 4: Profile, Roles, Integrations (IN PROGRESS)
- [x] Profile configuration
- [x] Multi-role session selection
- [x] Strava OAuth account connect/disconnect
- [x] Strava sync + day-by-day import UX
- [ ] Garmin integration (blocked on Garmin Health credentials)

### Stage 5: Coach Features (IN PROGRESS)
- [x] Coach templates and athlete assignment
- [x] Coach athlete overview
- [ ] Coach notes/feedback loop per activity/day
- [ ] Athlete invite flow

### Stage 6: Plan Import/Editing (IN PROGRESS)
- [x] Source-aware plan naming (filename/template)
- [x] Race data capture and alignment
- [x] Review workspace inline editing
- [x] Production-safe upload parsing flow (serverless temp storage + timeout)
- [ ] Drag-drop upload and parse progress UI
- [ ] Manual plan builder (no PDF)

### Stage 7: Calendar/Progress/Execution (IN PROGRESS)
- [x] Dedicated month calendar
- [x] Day details panel with planned + logged activities
- [x] Manual day completion with cross-view status reflection
- [x] Progress page v1
- [ ] Further mobile polish across dashboard/calendar/detail

### Stage 8: Admin & Operations (IN PROGRESS)
- [x] Admin role + protected admin route/API
- [x] Admin bootstrap CLI (`npm run make-admin -- <email>`)
- [x] Admin user management (role changes, deactivate/reactivate)
- [x] Production deployment baseline (Vercel + Clerk + Neon)
- [x] Branch hygiene cleanup (`codex/log-actuals` merged + deleted)
- [ ] Plan moderation controls
- [ ] Admin audit logging

---

## D. Feature Checklist (Current)

| Feature | Status |
|---|---|
| Authentication + role guards | Done |
| Multi-role session selection | Done |
| PDF parsing + review + publish | Done |
| Template -> assigned plan flow | Done |
| Race-date alignment of plan weeks | Done |
| Dashboard today/next-up alignment | Done |
| Activity completion + actuals logging | Done |
| Calendar month view | Done |
| Calendar day details (planned + logs) | Done |
| Manual day completion (calendar) | Done |
| Day completion reflected on dashboard status | Done |
| Race details editing in calendar flow | Done |
| Strava OAuth account management | Done |
| Strava plan-window sync (start->today) | Done |
| Strava day-by-day import to workout logs | Done |
| Production deploy baseline (Vercel/Clerk/Neon) | Done |
| Upload API serverless hardening | Done |
| Garmin integration | Pending |
| Coach notes/comments | Pending |
| Plan moderation/admin audit | Pending |

---

## E. Progress

### Overall: **89%**

| Area | Progress |
|---|---|
| Auth & Role System | 98% |
| Plan Parsing & Import | 92% |
| Dashboard Execution UX | 94% |
| Calendar & Date Alignment | 95% |
| Workout Logging | 90% |
| Strava Integration | 80% |
| Coach Features | 60% |
| Admin & Operations | 78% |
| Garmin Integration | 10% |
| Analytics/Reports | 30% |

---

## F. Next Actions (Priority)

1. **Upload UX reliability improvements**
   Add visible parse progress/states and clear recovery actions on timeout/parser failures.
2. **Strava conflict-resolution UX**
   Improve manual remap for multi-activity mismatch on same day.
3. **Background sync jobs**
   Scheduled sync + retry behavior + integration health visibility.
4. **Coach feedback model**
   Coach notes/comments per day/activity with athlete acknowledgement.
5. **Admin moderation tools**
   Plan publish/archive/feature controls + audit trail.
6. **Garmin integration completion**
   OAuth/account link + import flow once partner credentials are available.

---

## G. Session Update Rules

At the end of each session, Codex must:
1. Update the top "Last updated" line
2. Reflect finished work in stage checklists and feature checklist
3. Recalculate progress percentages in Section E
4. Refresh Section F priorities based on current bottlenecks
5. Keep Section B (Current System Logic) accurate and explicit
