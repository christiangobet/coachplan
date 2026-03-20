# Coach History Conversation UI Plan

> **Status: COMPLETED** — implemented and merged to main

## Summary

Make Coach History on the plan detail page feel like a readable conversation archive on iPhone and desktop:
- include athlete prompts as well as coach replies
- show at least a date tag on each turn
- present the history as a left/right conversation stream, closer to an iMessage-style archive

## Current Assessment

The affected user is the athlete on [src/app/plans/[id]/page.tsx](/Users/christiangobet/CODEX/coachplan/src/app/plans/[id]/page.tsx), opening the `Coach History` accordion to understand what was asked and what the coach recommended.

What is happening now:
- the UI can render athlete, coach, and system roles, but the main AI Trainer generation flow does not persist athlete prompts to `planChatMessage`
- `generateAiAdjustment()` explicitly bypasses `/api/plans/[id]/chat` and carries a TODO about duplicate AI calls
- as a result, the history archive often shows only coach/system entries and loses the conversational context
- the visual treatment is card-like, but not yet optimized as a conversation transcript
- no explicit date chip is shown in the accordion entries

UX risk:
- the history reads like disconnected coach notes instead of a conversation
- users cannot trust or reconstruct why a recommendation was made
- the archive feels different from the live chat surface, so it is harder to map “what I asked” to “what happened”

## Options

### Option A: Minimal archive fix

Persist athlete prompts for AI Trainer requests and add a small date label above each history message.

Impact:
- fixes the missing context bug fast
- low implementation risk

Trade-off:
- history becomes complete, but still feels like a plain list rather than a conversation UI

### Option B: Recommended

Persist athlete prompts and upgrade the Coach History accordion into a real conversation archive:
- newest-first group order
- left/right bubbles for athlete vs coach
- compact date chip or day stamp
- keep system messages visually quieter

Impact:
- best balance of readability, trust, and implementation scope

Trade-off:
- slightly more UI work than the minimal fix

### Option C: Full shared-thread model

Unify the live AI Trainer thread and Coach History into one persisted conversation model with a shared renderer.

Impact:
- strongest long-term consistency

Trade-off:
- highest risk because it touches more state and interaction paths

## Recommendation

Choose Option B.

It fixes the real data gap first, then makes the archive easier to scan without forcing a larger chat-architecture refactor.

## Implementation Plan

### 1. Persist athlete prompts for AI adjust requests

Files:
- `src/app/plans/[id]/page.tsx`
- `src/app/api/plans/[id]/chat/route.ts`
- `src/lib/plan-chat-ai.ts`

Approach:
- add a save-only path for athlete prompts that persists the message without triggering a second AI response
- call that save path from `generateAiAdjustment()` before or alongside the AI adjust request
- keep the existing AI adjust generation endpoint for proposal creation

Success criteria:
- every athlete prompt sent through AI Trainer appears in `planChatMessage`
- Coach History shows the same athlete wording the user typed

### 2. Add explicit timestamp display in Coach History

Files:
- `src/app/plans/[id]/page.tsx`
- `src/app/plans/plans.css`

Approach:
- render a compact date/time chip for each history turn
- use a short athlete-friendly format such as `Mar 14` or `Mar 14, 09:42`
- optionally collapse repeated same-day labels later, but not required for the first pass

Success criteria:
- each turn can be placed in time at a glance

### 3. Upgrade the accordion to a conversation transcript style

Files:
- `src/app/plans/[id]/page.tsx`
- `src/app/plans/plans.css`

Approach:
- keep athlete turns right-aligned
- keep coach turns left-aligned
- style system turns as centered, quiet notes
- preserve newest-first order at the group level
- make bubble spacing and max width feel like message history rather than admin logs

Success criteria:
- users can scan the archive as a conversation
- role distinction is obvious without reading labels first

### 4. Keep proposal state visible but secondary

Files:
- `src/app/plans/[id]/page.tsx`
- `src/app/plans/plans.css`

Approach:
- keep `Applied` / `History` / `Replaced` state chips
- place them alongside the timestamp or in a quieter metadata row
- do not let state badges overpower the actual message content

Success criteria:
- status remains visible without breaking conversation flow

### 5. Verification

Test cases:
- athlete sends a new AI Trainer request and both athlete + coach turns appear in history after reload
- Coach History shows newest-first ordering
- each message shows a date tag
- athlete/coach/system roles remain visually distinct
- mobile at `390px` still reads clearly and does not cause cramped bubbles

Commands:
- `npm run typecheck`
- `npm run lint`

