# CoachPlan — Project Plan

> **Last updated:** 2026-02-13 (Strava day-by-day import workflow + calendar day details + manual day completion + race edit flow moved to Calendar)
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

---

## B. Current System Logic (Authoritative)

### Roles and Access
- Three environments/roles: `ATHLETE`, `COACH`, `ADMIN`
- If a user has multiple roles, login/session flow prompts role selection
- Protected route guards enforce role context (`/dashboard`, `/coach`, `/admin`)

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
- Right column status now reflects recent day-level done/pending states

### Strava Sync and Import Logic
- Strava account is athlete-specific per logged-in user
- Sync window is now: **plan start date -> today** when using dashboard sync actions
- Comparison table rows are by day:
  - Date
  - Plan activities for date
  - Strava activities for same date
  - Row action: `Import` / `Re-import` / `Done`
- Import behavior:
  - Matches same-day Strava entries to same-day plan activities
  - Writes actuals to plan activity log (`completed`, `completedAt`, `actualDistance`, `actualDuration`, `actualPace`, notes)
  - Uses fallback matching if strict type match is weak but day-level mapping is clear
- Row status semantics:
  - `Pending import`: no matched Strava activities yet
  - `Partial match`: some matched
  - `Done`: all Strava activities for that day matched

### Calendar Logic
- Calendar is month view aligned to training dates
- Clicking a day opens detailed day context in right panel
- Day details include:
  - Planned activities
  - Logged actuals on plan activities
  - External logs (Strava/etc.) for that day with matched/unmatched info
- Manual day completion is supported:
  - User can mark day done/not done from day details
  - Day done shows green tick in calendar
  - Day done is reflected in dashboard right-column status
  - Manual done marker stored in `PlanDay.notes` tag (`[DAY_DONE]`)

### Race Detail Editing Flow
- Race editing was intentionally moved out of `/plans/[id]`
- New canonical location: `/calendar` -> Selected Plan card -> `Edit race details`
- Plan detail page now focuses on workout execution only

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
| Garmin integration | Pending |
| Coach notes/comments | Pending |
| Plan moderation/admin audit | Pending |

---

## E. Progress

### Overall: **86%**

| Area | Progress |
|---|---|
| Auth & Role System | 96% |
| Plan Parsing & Import | 90% |
| Dashboard Execution UX | 94% |
| Calendar & Date Alignment | 95% |
| Workout Logging | 90% |
| Strava Integration | 78% |
| Coach Features | 60% |
| Admin & Operations | 68% |
| Garmin Integration | 10% |
| Analytics/Reports | 30% |

---

## F. Next Actions (Priority)

1. **Garmin integration completion**  
   OAuth, account link, and activity import pipeline (pending partner credentials)
2. **Strava conflict-resolution UX**  
   Handle multi-activity mismatch scenarios with explicit manual remap UI
3. **Background sync jobs**  
   Scheduled sync, retry behavior, and integration health visibility
4. **Coach feedback model**  
   Coach notes/comments per day/activity with athlete read acknowledgments
5. **Admin moderation tools**  
   Plan publish/archive/feature controls + audit trail
6. **Mobile execution polish**  
   Tighten dashboard/calendar/day-detail interactions on small screens

---

## G. Session Update Rules

At the end of each session, Codex must:
1. Update the top "Last updated" line
2. Reflect finished work in stage checklists and feature checklist
3. Recalculate progress percentages in Section E
4. Refresh Section F priorities based on current bottlenecks
5. Keep Section B (Current System Logic) accurate and explicit
