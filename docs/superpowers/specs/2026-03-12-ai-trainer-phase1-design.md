# AI Trainer Phase 1 — Design Spec

**Date:** 2026-03-12
**Scope:** AI trainer improvements — chat persistence, drag/drop awareness, UI simplification, performance context

---

## Overview

The existing AI trainer has solid backend infrastructure (rich system prompt, 6 change operations, safety guards, proposal tokens) but feels weak because:
- Chat state is ephemeral — lost on page reload
- AI is blind to manual drag/drop moves
- Proposal UI is dense/technical, not conversational
- AI has no knowledge of recent training performance

This phase makes the AI feel like an observing coach rather than a chatbot, grounds it in real athlete data, and persists all interactions to the database.

---

## Scope

Four deliverables:

1. **Drag/drop → AI chat reaction** — moves trigger AI commentary in the chat panel
2. **Persist chat to DB** — full conversation history + change audit log survive page reload
3. **Conversational proposal UI** — simplified rendering, details hidden by default
4. **Strava + manual activity context** — AI receives recent performance data on every call

---

## Data Model

Two new Prisma tables, plus back-relation fields added to `TrainingPlan`:

```prisma
model PlanChatMessage {
  id        String       @id @default(cuid())
  planId    String
  plan      TrainingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  role      String       // "athlete" | "coach" | "system"
                         // When building OpenAI context: "athlete"→"user", "coach"→"assistant", "system"→"system"
  content   String       // natural language text
  metadata  Json?        // see MessageMetadata type below
  createdAt DateTime     @default(now())

  @@index([planId, createdAt])
}

model PlanChangeLog {
  id         String       @id @default(cuid())
  planId     String
  plan       TrainingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  source     String       // "manual_drag" | "ai_applied" | "manual_edit"
  changeType String       // "move_activity" | "edit_activity" | "add_activity" | "delete_activity"
  activityId String?
  fromDayId  String?
  toDayId    String?
  before     Json?        // DaySnapshot for source day before move (see type below)
  after      Json?        // DaySnapshot for destination day after move
  editSessionId String?   // server-generated token, set when isEditMode → true
  createdAt  DateTime     @default(now())

  @@index([planId, createdAt])
}
```

**Back-relations to add to `TrainingPlan` in schema.prisma:**
```prisma
chatMessages PlanChatMessage[]
changeLogs   PlanChangeLog[]
```

### TypeScript types for JSON fields

```typescript
// PlanChatMessage.metadata
type MessageMetadata = {
  // For role="coach" messages that include a proposal:
  proposal?: PlanAdjustmentProposal;
  state?: 'active' | 'applied' | 'superseded'; // default: "active"
  // For role="system" move-note messages:
  changeLogIds?: string[];
};

// PlanChangeLog.before / .after
type DaySnapshot = {
  dayId: string;
  activities: Array<{
    id: string;
    type: string;        // ActivityType enum value
    subtype: string | null;
    title: string;
    duration: number | null;  // minutes
    distance: number | null;
    distanceUnit: string | null;
    priority: string | null;
  }>;
};
```

### Proposal state transitions

- New coach message → `state: "active"`
- Athlete sends a new message → all existing `active` coach messages for this plan become `state: "superseded"` (server updates on save of new athlete message)
- Athlete applies a proposal → that message's `state` becomes `"applied"` (server updates on apply)
- An older proposal can still be applied even if superseded — the app allows it

### AI context window (every call)
- Last 30 `PlanChatMessage` entries for this plan (newest last)
- Last 14 days of `PlanChangeLog` entries
- Last 14 days of completed activities (Strava-matched + manually logged) — see Performance Context section

---

## API

### New endpoints

**`POST /api/plans/[id]/edit-session`**
Called when athlete enters edit mode. Returns `{ editSessionId: string }` — a server-generated cuid used to fence PlanChangeLog entries for this edit session.

**`GET /api/plans/[id]/chat?limit=50`**
Returns last N messages for chat panel hydration on page load.

**`POST /api/plans/[id]/chat`**
Two triggers:
- `{ trigger: "athlete_message", content: "..." }` — athlete typed a message
- `{ trigger: "drag_drop", changeLogIds: ["...", "..."] }` — one or more moves (5s debounce accumulated); AI does risk scan
- `{ trigger: "edit_session_end", editSessionId: "..." }` — "Done Editing" tapped; AI generates summary

**Response pattern — synchronous, no polling:**
The POST handler runs the AI call inline and returns the complete coach message before responding:
```json
{
  "coachMessage": { "id": "...", "role": "coach", "content": "...", "metadata": { ... }, "createdAt": "..." } | null,
  "silent": true
}
```
- `coachMessage` is `null` when Tier 1 risk scan finds no issues (silent move)
- `silent: true` signals the client not to open/highlight the chat panel
- No polling endpoint needed — the client appends the returned message directly

### Existing endpoint change
`POST /api/plans/[id]/ai-adjust` — when `apply=true`, write a `PlanChangeLog` entry with `source: "ai_applied"` alongside the existing apply logic.

---

## Drag/Drop → AI Flow

```
1. Athlete drops activity onto new day (existing handler)
   ↓
2. PATCH activity move (existing) — saves to DB
   ↓
3. Write PlanChangeLog entry
   source: "manual_drag"
   before: activity list of source day before move
   after: activity list of destination day after move
   ↓
4. Client starts 5s debounce timer
   (resets if another move happens within 5s; accumulates changeLogIds)
   ↓
5. After 5s — POST /api/plans/[id]/chat
   { trigger: "drag_drop", changeLogIds: ["id1", "id2", ...] }
   ↓
6. Server builds context: recent messages + change log + performance data
   AI runs risk assessment on accumulated moves
   ↓
7a. Risk detected → AI generates short comment (50-120 words) + optional follow-up
    Save as PlanChatMessage (role: "system" for move note, "coach" for reply)
    POST returns { coachMessage: { ... }, silent: false }
7b. No risk → silent, no message saved
    POST returns { coachMessage: null, silent: true }
   ↓
8. Client appends returned coachMessage directly to chat panel (no polling)
```

**Risk detection criteria (fires Tier 1 comment):**
- Back-to-back hard/quality sessions on consecutive days
- Load spike: destination day now has 2+ quality sessions
- Race week conflict: quality session moved into race week
- Move into a week with unusually high weekly load

Safe moves (easy runs, rest day swaps, cross-training) → silence.

---

## Edit Session End Flow

When athlete taps "Done Editing" (`isEditMode` → false):

```
0. When athlete taps "Edit Plan" (isEditMode → true):
   Client calls POST /api/plans/[id]/edit-session → server returns { editSessionId: "cuid" }
   Client stores editSessionId in React state for the duration of edit mode
   All PlanChangeLog entries written during this session include this editSessionId
   ↓
1. When athlete taps "Done Editing":
   Collect editSessionId from state
   ↓
2. POST /api/plans/[id]/chat
   { trigger: "edit_session_end", editSessionId: "..." }
   Server queries PlanChangeLog WHERE editSessionId = X (no clock drift risk)
   ↓
3. AI generates consolidated summary of all changes in this session
   Always fires (even if no risks detected)
   Max 150 words. Conversational tone.
   Example: "This week you moved tempo to Saturday and swapped recovery to
   Thursday — net effect is two quality days closer together. Manageable,
   but keep Sunday's long run easy."
   ↓
4. Saved as coach message, appended to chat
```

---

## Chat Persistence

**Page load:**
```
GET /api/plans/[id]/chat?limit=50
→ hydrate chat panel with full history (newest at bottom)
→ proposals in metadata rendered with correct state:
   - applied → greyed, collapsed to single line
   - active → full proposal UI
   - superseded → dimmed with "replaced" badge
```

**Athlete message:**
```
POST /api/plans/[id]/chat { trigger: "athlete_message", content }
→ saves athlete message immediately (role: "athlete")
→ marks any existing "active" coach messages as "superseded"
→ runs AI call inline (synchronous)
→ saves AI response as coach message (role: "coach", state: "active")
→ returns { coachMessage: { ... } }
→ client appends returned message directly to chat panel
```

**Token budget:**
AI always receives last 30 messages + 14-day change log. Older history is stored in DB but not sent to AI. Keeps token cost predictable.

---

## Performance Context (Strava + Manual)

On every AI call, include a structured summary of the last 14 days of completed activities:

```
Query:
  PlanActivity
    WHERE planId = X AND completed = true
    AND completedAt >= (now - 14 days)
    include: day { dayOfWeek, week { startDate } }   ← to derive calendar date for display
    include: externalActivities (via ExternalActivity.matchedPlanActivityId = PlanActivity.id)
              → avgHeartRate (Int?), movingTimeSec (Int?), distanceM (Float?)

  Note: completedAt is used for the 14-day filter. For manually-done activities where
  completedAt may be null, fall back to deriving the date from
  day.week.startDate + (day.dayOfWeek - 1) days.

  Include manually logged actuals from PlanActivity: actualPace, actualDuration, actualDistance.
  Include Strava fields from ExternalActivity: avgHeartRate, movingTimeSec, distanceM (÷ 1000 for km).
  Prefer Strava values over manual when both exist.

Format for AI:
"Recent performance (last 14 days):
  Mar 10 — Easy run 8.2km @ 5:45/km, HR 138 [Strava]
  Mar 8  — Tempo 11.8km @ 4:52/km, HR 162 [Strava]
  Mar 6  — Long run 22km @ 5:55/km — no HR [manual]
  Mar 4  — Rest — skipped (no log)"
```

Source tag `[Strava]` vs `[manual]` helps AI weight data confidence.

Guard: if athlete has no completed activities in last 14 days, omit this section — no change to UX.

---

## AI Awareness of Cascading Effects

**Problem:** When AI suggests "move Tempo to Thursday", it must check what's already on Thursday.

**Solution — two changes:**

1. `PlanChangeLog.before/after` captures full activity snapshots for source and destination days. AI receives this with every call, giving it ground truth of what changed and what was already there.

2. New rule added to AI system prompt:
   > "Before suggesting a move_activity, check the target day's existing activities. If the target day already has a session, mention the stacking in your coachReply. If a swap is more appropriate (athlete likely intended to exchange two sessions), generate two move_activity changes — one for each direction."

The app's `applyAdjustmentProposal` already supports multi-change proposals and stacking multiple activities per day, so no backend changes needed for this.

---

## Proposal UI — Conversational Style

**Current:** Dense panel showing confidence score, invariant report, week balance metrics, risk flags all at once.

**New default rendering:**

```
┌──────────────────────────────────────────────────┐
│ [system note, muted]  You moved Tempo → Sat      │
├──────────────────────────────────────────────────┤
│ Coach                                            │
│ Back-to-back quality days Sat + Sun this close   │
│ to race week. I'd move it back to Thursday.      │
│                                                  │
│ [italic muted] Is this a permanent change or     │
│ are you working around something this week?      │
├──────────────────────────────────────────────────┤
│ ● Move Tempo Run → Thursday          [Apply]     │
│                                                  │
│ [Apply all]              ▸ Show details          │
└──────────────────────────────────────────────────┘
```

- **"Show details"** expands: confidence level, risk flags, week balance metrics — same data as today
- **Applied proposals** collapse to greyed line: *"Coach suggestion applied — Mar 10"*
- **Superseded proposals** (athlete sent new message before applying) show a dimmed "replaced" badge
- No changes to proposal generation logic — purely a rendering change

---

## Three-Tier Engagement Model

| Tier | Trigger | AI Response | Always fires? |
|------|---------|-------------|---------------|
| 1 | 5s after last drag/drop | Short risk comment (if risk detected) | No — only on risk |
| 2 | "Done Editing" tapped | Session summary of all changes | Yes — always |
| 3 | Athlete types in chat | Full AI response + proposal | Yes |

Tier 2 is the primary coaching moment. Tier 1 is the safety net.

---

## What Is NOT Changing

- AI proposal generation logic (`/api/plans/[id]/ai-adjust`) — unchanged
- Change operation types (`move_activity`, `edit_activity`, etc.) — unchanged
- Apply token / SHA256 verification — unchanged
- Multi-provider AI support (OpenAI / Cloudflare / Gemini) — unchanged
- Existing chat UI layout — only message rendering updated

---

## Out of Scope

- Streaming AI responses
- Voice input
- Coach approval workflow
- Multi-athlete features
- Fine-tuned model
