# CoachPlan — Project Plan

> **Last updated:** 2025-02-12
> **IMPORTANT:** Claude must update this file at the end of every session — refresh progress %, checklist status, and next actions.

---

## A. General Work Plan

CoachPlan is a training plan management app for endurance athletes and coaches. The goal is to deliver a polished, Strava-inspired experience where users can upload PDF training plans, align them to race dates, track daily workouts, and monitor progress over time.

### Core Value Proposition
1. **Upload & Parse** — Upload a PDF training plan and let AI extract structured weeks/days/activities
2. **Align to Race Day** — Automatically align week numbering so the plan peaks on race weekend
3. **Track & Complete** — Daily dashboard showing today's workout, upcoming sessions, and completion tracking
4. **Coach Connection** — Coaches can create templates, assign plans, and monitor athlete progress

### Tech Stack
- Next.js 16 (App Router) + TypeScript
- Clerk (auth) + PostgreSQL + Prisma ORM
- OpenAI API (gpt-4o-mini) for PDF parsing
- Python 3 + pdfplumber for PDF text extraction

---

## B. Implementation by Stages

### Stage 1: Foundation (DONE)
- [x] Next.js project setup with App Router
- [x] Clerk authentication (sign-in, sign-up, middleware)
- [x] PostgreSQL database with Prisma schema
- [x] User model with ATHLETE/COACH roles
- [x] Training plan, week, day, activity models
- [x] PDF upload and parsing pipeline (Python + OpenAI)
- [x] Plan review page after parsing
- [x] Basic plan detail view

### Stage 2: UI Redesign — Strava-Inspired (DONE)
- [x] Global CSS overhaul: Figtree font, orange accent (#fc4c02), light gray background
- [x] Auth-aware header (different nav for signed-in vs signed-out)
- [x] Home page redirect for authenticated users
- [x] Dashboard redesign: hero workout card, weekly dot strip, plan progress, status feed
- [x] Plans list page: card grid layout with status dots
- [x] Plan detail: calendar grid view with 7-day layout, color-coded activity bars
- [x] Activity details: distance, pace, effort, instructions in calendar cells

### Stage 3: Workout Tracking & Interaction (IN PROGRESS)
- [x] Mark as Complete button on dashboard
- [ ] Mark as Complete from calendar view (per activity)
- [ ] Log actual distance, duration, pace after completing
- [ ] Undo completion
- [ ] Activity detail modal/drawer (click to expand full details)

### Stage 4: Profile & Settings (PARTIAL)
- [x] Profile page: name, role, units, race date, pace targets
- [x] Coach linking from athlete profile
- [ ] Strava/Garmin integration (OAuth connect)
- [ ] Auto-import activities from Strava
- [ ] Profile page UI refresh to match Strava style

### Stage 5: Coach Features (PARTIAL)
- [x] Coach dashboard: create templates, assign to athletes
- [ ] Coach dashboard UI refresh to match Strava style
- [ ] Coach view of athlete progress (overview cards)
- [ ] Coach notes/feedback on individual activities
- [ ] Athlete invitation flow (email invite)

### Stage 6: Upload & Parsing Improvements
- [ ] Upload page UI refresh to match Strava style
- [ ] Drag-and-drop PDF upload
- [ ] Parse progress indicator (real-time status)
- [ ] Support more PDF formats (multi-sport, custom layouts)
- [ ] Manual plan creation (no PDF required)
- [ ] Edit parsed plan before publishing (inline editing)

### Stage 7: Advanced Features
- [ ] Calendar page (full month view with all activities)
- [ ] Progress page (charts: weekly volume, completion rate over time)
- [ ] Race countdown on dashboard
- [ ] Weekly email summary
- [ ] Mobile-responsive polish across all pages
- [ ] Dark mode toggle

---

## C. Checklist

### Pages — UI Status

| Page | Route | Status |
|------|-------|--------|
| Home (signed out) | `/` | Done |
| Dashboard | `/dashboard` | Done |
| Plans list | `/plans` | Done |
| Plan detail (calendar) | `/plans/[id]` | Done |
| Plan review | `/plans/[id]/review` | Needs refresh |
| Upload | `/upload` | Needs refresh |
| Profile | `/profile` | Needs refresh |
| Coach dashboard | `/coach` | Needs refresh |
| Calendar | `/calendar` | Not built |
| Progress | `/progress` | Not built |

### Core Features

| Feature | Status |
|---------|--------|
| Auth (sign in/up/out) | Done |
| PDF upload & parse | Done |
| Plan review & publish | Done |
| Race date alignment | Done |
| Dashboard today view | Done |
| Mark workout complete | Done (dashboard only) |
| Plan calendar view | Done |
| Activity details in calendar | Done |
| Complete from calendar | Not started |
| Log actuals (distance/time) | Not started |
| Strava integration | Not started |
| Coach athlete overview | Not started |
| Charts / progress page | Not started |

---

## D. Progress

### Overall: **45%**

| Area | Progress |
|------|----------|
| Auth & User Management | 90% |
| PDF Upload & Parsing | 85% |
| Dashboard | 85% |
| Plan Views | 80% |
| Workout Tracking | 30% |
| UI Consistency (Strava style) | 55% |
| Coach Features | 25% |
| Profile & Settings | 50% |
| Strava/Garmin Integration | 0% |
| Charts & Analytics | 0% |
| Calendar Page | 0% |

---

## E. Next Actions

Priority order for the next session:

1. **Complete from calendar** — Add a click-to-complete toggle on each activity in the plan calendar view
2. **Activity detail modal** — Click an activity in the calendar to see full details (rawText, pace, effort, notes) in a slide-out or modal
3. **Upload page UI refresh** — Align upload page styling with the Strava theme
4. **Profile page UI refresh** — Restyle profile page to match
5. **Coach dashboard UI refresh** — Card-based layout, athlete progress overview
6. **Plan review page refresh** — Match Strava style before publishing flow

---

## F. Session Update Instructions

> **Claude: At the end of every work session, you MUST update this file:**
>
> 1. Update the "Last updated" date at the top
> 2. Move completed items from "Next Actions" and check them off in the checklist
> 3. Update the progress percentages in Section D
> 4. Update stage status labels (DONE / IN PROGRESS / NOT STARTED)
> 5. Add any new items discovered during the session to the appropriate stage
> 6. Set the next 5-6 priority actions in Section E based on what makes sense next
>
> This file is the single source of truth for project status.
