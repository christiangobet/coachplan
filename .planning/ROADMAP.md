# Roadmap: CoachPlan v1 Beta

**Milestone:** v1 Beta
**Goal:** Beta-ready app that a small group of endurance athletes can use daily on iPhone, with a reliable desktop setup flow.
**Created:** 2026-03-27
**Granularity:** Coarse (4 phases, 1-3 plans each)

---

## Phases

- [ ] **Phase 1 — Daily Experience Redesign** - Unified today view with clear hierarchy; athletes immediately know what to do and how far they are through their plan
- [ ] **Phase 2 — Mobile Calendar Polish** - Calendar readable and usable on iPhone 390px; day cells breathe; day detail navigation is clear
- [ ] **Phase 3 — Coach Chat & AI Editing** - Interaction bugs fixed; AI capabilities clear to user; edits apply correctly and feel integrated
- [ ] **Phase 4 — Setup Flow & Beta Readiness** - Upload→parse→activate works reliably; new athletes onboard without help; app stable for daily use

---

## Phase Details

### Phase 1 — Daily Experience Redesign

**Goal:** Athletes open the app and immediately see today's workout, their week position, and progress vs plan — without confusion about which screen to use.
**Depends on:** Nothing (first phase)
**Requirements:** DAILY-01, DAILY-02, DAILY-03, DAILY-04, DAILY-05

**Success Criteria** (what must be TRUE):
1. Athlete opens the app to a single screen that shows today's workout without needing to navigate elsewhere
2. Athlete sees "Week 6 of 18" (or equivalent) in today's view — not buried in another screen
3. Athlete sees a summary of completed vs planned volume for the current week
4. Each of the three main screens (dashboard, calendar, plan view) has a distinct, non-overlapping purpose
5. Athlete can identify at a glance which screen to use for daily logging, week overview, and plan structure

### Plans

1. **Audit & restructure screen hierarchy** — Map what currently lives on dashboard / calendar / plan view; decide the canonical purpose of each; remove duplicated content so each screen owns its scope cleanly
2. **Build unified today view** — Redesign dashboard as the daily execution screen: today's workout prominent, week X of Y label, progress bar or ring for week completion; keep it focused and mobile-first
3. **Wire navigation to new hierarchy** — Update nav labels and routing so tapping each item leads to the right screen for the right job; remove dead or redundant nav paths

**UI hint**: yes

---

### Phase 2 — Mobile Calendar Polish

**Goal:** The calendar view is the weekly overview athletes use on iPhone — it must be readable, give enough info per day at a glance, and make day detail tap-through obvious.
**Depends on:** Phase 1
**Requirements:** CAL-01, CAL-02, CAL-03

**Success Criteria** (what must be TRUE):
1. Calendar renders correctly on iPhone 390px without horizontal scroll or clipped content
2. Each day cell shows the activity type and one key metric (distance or duration) without crowding
3. Tapping a day cell opens the day detail panel with a clear back path to the calendar
4. Past days with completed activities look visually distinct from missed and future days

### Plans

1. **Reflow calendar grid for 390px** — Audit day cell layout at 390px; fix cell sizing, font sizes, and spacing so the full week fits without cramping; apply iOS safe-area and dvh constraints
2. **Day detail navigation clarity** — Ensure tapping a day cell clearly opens detail, with a back/close affordance; fix any confusion between calendar grid state and day panel open state

**UI hint**: yes

---

### Phase 3 — Coach Chat & AI Editing

**Goal:** Coach chat works reliably, athletes understand what the AI can do, and AI-suggested edits land correctly in the plan.
**Depends on:** Phase 1
**Requirements:** CHAT-01, CHAT-02, CHAT-03, CHAT-04

**Success Criteria** (what must be TRUE):
1. Messages send and AI responses display without UI glitches or stuck states
2. A first-time athlete can read the chat UI and understand what kinds of edits to ask for (and what is out of scope)
3. The chat panel is accessible from within the plan editing flow, not only from a standalone page
4. Asking the AI to change a workout (e.g. "make Tuesday a rest day") results in that change being applied and visible in the plan immediately

### Plans

1. **Fix chat interaction bugs** — Audit message send / receive flow; fix any state where UI hangs, responses don't display, or send fails silently; stabilize JSON parse failure handling in AI response path (`openai.ts:173`, `ai-summary-extractor.ts:82`)
2. **Clarify AI capabilities UI + integrate into plan editing** — Add a concise capability hint in the chat panel (what you can ask, what you can't); ensure chat is reachable from the plan review/edit flow not just in isolation; verify that AI-applied edits write correctly to PlanDay/PlanActivity and re-render the plan

**UI hint**: yes

---

### Phase 4 — Setup Flow & Beta Readiness

**Goal:** The upload→parse→activate flow works reliably for standard training plan PDFs; new athletes can complete it without help; the app is stable and notifications and Strava sync work correctly.
**Depends on:** Phase 1, Phase 3
**Requirements:** SETUP-01, SETUP-02, SETUP-03, SETUP-04, BETA-01, BETA-02, BETA-03

**Success Criteria** (what must be TRUE):
1. Uploading a standard endurance training PDF (e.g. Pfitzinger, Higdon, custom coach) produces a correctly structured plan without manual intervention beyond review
2. The review screen lets athletes correct any parsing errors before activating — no data is silently wrong or uneditable
3. Activating with RACE_DATE or START_DATE produces correct week alignment with no edge-case failures
4. A new athlete following the flow cold can reach a daily-logged workout within one session, without asking for help
5. Push notifications fire for today's workout at the scheduled time — no duplicates, no missing fires
6. Strava sync matches completed runs/rides to planned activities correctly for the common case; mismatches surface (not silently drop)

### Plans

1. **Harden PDF parse pipeline** — Audit parse quality threshold (currently `PARSE_MIN_QUALITY_SCORE < 30` can reject valid plans); fix silent AI budget exhaustion for large plans; wrap unvalidated `JSON.parse` calls with try-catch + Zod validation; test against 3-5 real plan PDFs
2. **Smooth the setup UX end-to-end** — Walk the full upload→review→activate flow as a new user; fix any dead ends, confusing states, or missing affordances; ensure activation edge cases (unusual race dates, missing weeks) fail gracefully with a clear message
3. **Verify notifications, Strava sync, and stability** — Confirm push notifications fire correctly and aren't duplicated; test Strava sync match rate and surface equivalence mismatches in the UI rather than silently dropping them; smoke-test for crashes or data loss under normal daily-use patterns

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1 — Daily Experience Redesign | 0/3 | Not started | - |
| 2 — Mobile Calendar Polish | 0/2 | Not started | - |
| 3 — Coach Chat & AI Editing | 0/2 | Not started | - |
| 4 — Setup Flow & Beta Readiness | 0/3 | Not started | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| DAILY-01 | Phase 1 | Pending |
| DAILY-02 | Phase 1 | Pending |
| DAILY-03 | Phase 1 | Pending |
| DAILY-04 | Phase 1 | Pending |
| DAILY-05 | Phase 1 | Pending |
| CAL-01 | Phase 2 | Pending |
| CAL-02 | Phase 2 | Pending |
| CAL-03 | Phase 2 | Pending |
| CHAT-01 | Phase 3 | Pending |
| CHAT-02 | Phase 3 | Pending |
| CHAT-03 | Phase 3 | Pending |
| CHAT-04 | Phase 3 | Pending |
| SETUP-01 | Phase 4 | Pending |
| SETUP-02 | Phase 4 | Pending |
| SETUP-03 | Phase 4 | Pending |
| SETUP-04 | Phase 4 | Pending |
| BETA-01 | Phase 4 | Pending |
| BETA-02 | Phase 4 | Pending |
| BETA-03 | Phase 4 | Pending |

**Coverage:** 19/19 v1 requirements mapped. No orphans.

---

*Created: 2026-03-27*
