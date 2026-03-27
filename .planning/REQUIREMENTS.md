# Requirements: CoachPlan v1 Beta

**Defined:** 2026-03-27
**Core Value:** An athlete opens the app on their iPhone and immediately knows what to do today, how far they are through their plan, and how their actual training compares to what was planned.

## v1 Requirements

### Daily Experience

- [ ] **DAILY-01**: Athlete sees today's planned workout immediately on opening the app
- [ ] **DAILY-02**: Athlete sees current week number and total weeks in plan (e.g. "Week 6 of 18")
- [ ] **DAILY-03**: Athlete sees progress vs plan (completed vs planned activities/volume)
- [ ] **DAILY-04**: Navigation between screens is unambiguous — each screen has a clear distinct purpose
- [ ] **DAILY-05**: Dashboard, calendar, and plan view do not duplicate each other's core content

### Mobile Calendar

- [ ] **CAL-01**: Calendar view is readable and usable on iPhone (390px) without feeling cramped
- [ ] **CAL-02**: Day cells provide enough space for activity type and key info at a glance
- [ ] **CAL-03**: Tapping a day opens the day detail without confusion about where you are

### Coach Chat & AI Editing

- [ ] **CHAT-01**: Coach chat interface has no interaction bugs (messages send reliably, responses display correctly)
- [ ] **CHAT-02**: It is clear to the athlete what the AI coach can and cannot do
- [ ] **CHAT-03**: Coach chat feels integrated into the plan editing flow, not isolated
- [ ] **CHAT-04**: AI-suggested plan edits are applied correctly and reflected in the plan

### Setup Flow (Desktop/iPad)

- [ ] **SETUP-01**: PDF upload succeeds reliably for standard endurance training plan formats
- [ ] **SETUP-02**: Parsed plan structure is correctable before activation
- [ ] **SETUP-03**: Plan activation (RACE_DATE / START_DATE) works without edge-case failures
- [ ] **SETUP-04**: A new athlete can complete the full setup flow without external help

### Beta Readiness

- [ ] **BETA-01**: App is stable enough for daily use by a small group of athletes without crashes or data loss
- [ ] **BETA-02**: Push notifications fire at the right time for today's workout
- [ ] **BETA-03**: Strava sync reliably matches completed activities to planned ones

## v2 Requirements

### Coach Mode

- **COACH-01**: Coach can manage multiple athlete plans from a single dashboard
- **COACH-02**: Coach can assign and modify plans for athletes
- **COACH-03**: Coach can view athlete progress and compliance

### Garmin Integration

- **GARMIN-01**: Athlete can connect Garmin account (pending partner credentials)
- **GARMIN-02**: Garmin activities sync and match to planned workouts

### Advanced AI

- **AI-01**: AI can generate a full training plan from scratch given race goal and athlete profile
- **AI-02**: AI can suggest adaptive adjustments based on logged fatigue/performance

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native iOS/Android app | Web-first PWA sufficient for v1 beta |
| Garmin integration | Partner credentials not available |
| Social/community features | Not core to v1 value |
| Multi-athlete coach dashboard | v2 — too complex for v1 scope |
| AI plan generation from scratch | Editing existing plans sufficient for v1 |

## Traceability

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

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-27*
*Last updated: 2026-03-27 after initial definition*
