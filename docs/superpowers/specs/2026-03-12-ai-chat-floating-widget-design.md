# AI Coach Floating Chat Widget — Design Spec

**Date:** 2026-03-12
**Scope:** Plan page only (`/plans/[id]`). Floating chatbot widget at bottom-right replacing the inline interaction panel.

---

## Overview

The AI Trainer currently lives inside a `<details>` accordion panel embedded in the plan page. This feels buried. The new design surfaces it as a persistent floating chatbot widget (bottom-right), while the accordion becomes a read-only history of past coaching conversations.

---

## Architecture

**Approach:** Add a fixed-positioned `<div>` at the bottom of the existing page.tsx JSX. Shares all existing state — no extraction, no prop threading. One new boolean state: `chatOpen`.

**Files changed:**
- `src/app/plans/[id]/page.tsx` — add widget JSX, new `chatOpen` state, simplify accordion body
- `src/app/plans/plans.css` — new widget CSS classes

---

## State

No existing state changes. New addition only:

```typescript
const [chatOpen, setChatOpen] = useState(false);
```

Existing state used by the widget (unchanged, exact names from page.tsx):
- `aiChatTurns` — in-session messages
- `aiTrainerProposal` — active proposal with apply handlers
- `aiTrainerLoading` — AI call in progress (disables send + apply buttons)
- `aiTrainerApplying` — proposal apply in progress (also disables send + apply buttons)
- `aiTrainerInput` / `setAiTrainerInput` — controlled input field value
- `aiTrainerError` — error display
- `chatMessages` — DB-persisted history (accordion only)

New state:
```typescript
const [chatOpen, setChatOpen] = useState(false);
const [hasUnread, setHasUnread] = useState(false);
```

`hasUnread` lifecycle:
- Set to `true` whenever a new coach message is appended to `aiChatTurns` (or `chatMessages`) AND `chatOpen` is `false`
- Set to `false` when the widget is opened (`setChatOpen(true)` also calls `setHasUnread(false)`)

---

## Widget UI

### Positioning

```css
position: fixed;
bottom: 24px;
right: 24px;
z-index: 1000;
```

Mobile (≤640px): full-width tray:
```css
bottom: 0;
left: 0;
right: 0;
border-radius: 16px 16px 0 0;
```

### Closed state — pill button

```tsx
<button className="ai-widget-pill" onClick={() => setChatOpen(true)}>
  🏃 Coach
  {hasUnread && <span className="ai-widget-unread-dot" />}
</button>
```

- Style: matches `dash-btn-primary`, orange background (`var(--d-orange)`), white text
- Unread dot: small circle indicator when a new AI message arrived while widget was closed
- Always visible on the plan page, never hidden

### Open state — chat panel (360px wide, max-height 520px)

```
┌──────────────────────────────────┐
│ 🏃 AI Coach            [—]  [✕] │  ← orange header
├──────────────────────────────────┤
│  scrollable message thread       │
│  [coach bubble]                  │
│             [athlete bubble]  →  │
│  [coach bubble]                  │
│                                  │
├──────────────────────────────────┤
│  [proposal block — if active]    │  ← only when aiTrainerProposal set
│  coach reply, changes, Apply btns│
├──────────────────────────────────┤
│  [text input]        [Send →]    │
└──────────────────────────────────┘
```

Header buttons:
- `[—]` minimise: closes to pill (`setChatOpen(false)`)
- `[✕]` clear chat: existing `clearAiChat()` handler

### Message bubbles

- Athlete messages: right-aligned, `background: var(--d-orange)`, white text
- Coach messages: left-aligned, `background: var(--d-bg)`, `color: var(--d-text)`, left border `var(--d-orange)`
- System notes (move descriptions): centered, muted text, `color: var(--d-muted)`

### Proposal block

Rendered inside the chat panel directly above the input:
- Coach reply text
- Follow-up question (italic, muted)
- Changes list with individual `[Apply]` buttons
- `[Apply all]` + `[▸ Show details]` toggle
- Identical to the current conversational proposal UI already implemented

### Dark mode

All colours use existing CSS tokens — no hardcoded values:

| Element | Token |
|---|---|
| Header background | `var(--d-orange)` |
| Panel background | `var(--d-raised)` |
| Message bubble (coach) | `var(--d-bg)` |
| Message bubble (athlete) | `var(--d-orange)` |
| Text | `var(--d-text)` |
| Muted text | `var(--d-muted)` |
| Border | `var(--d-border)` |
| Input background | `var(--d-bg)` |

---

## Accordion — History Only

The existing `<details className="pcal-inline-panel">` AI Trainer accordion is simplified:

**Summary label:** `"Coach History"` (was `"AI Trainer"`)

**Body shows:**
- `chatMessages` from DB (past sessions, oldest first)
- Each message: role label + content + applied/superseded state badge
- Empty state: `"Your coaching conversations will appear here."`

**Body removes:**
- Input box and send button
- Proposal UI and apply handlers
- `aiChatTurns` (in-session messages) — these live in the widget only

The accordion is read-only. The floating widget is the sole interaction point.

---

## CSS Classes (new)

```
.ai-widget-container     — fixed positioning wrapper
.ai-widget-pill          — closed state button
.ai-widget-unread-dot    — unread indicator on pill
.ai-widget-panel         — open chat panel
.ai-widget-header        — orange header bar
.ai-widget-thread        — scrollable message area
.ai-widget-bubble        — single message bubble
.ai-widget-bubble--coach — coach variant (left-aligned)
.ai-widget-bubble--athlete — athlete variant (right-aligned)
.ai-widget-bubble--system  — system note (centered, muted)
.ai-widget-input-row     — bottom input + send button
.ai-widget-proposal      — proposal block above input
```

---

## Behaviour Notes

- Widget is only rendered when the plan page is loaded (not a global component)
- Pill stays visible at all times while on the plan page
- `chatOpen` starts `false` — widget opens only on explicit tap
- When a new coach message arrives (drag/drop AI or edit session end), if widget is closed: show unread dot on pill
- Auto-scroll to bottom of thread when new messages arrive and widget is open

---

## Out of Scope

- Animation/transitions (can be added later)
- Persist `chatOpen` state across page reloads
- Show widget on other pages (calendar, dashboard)
