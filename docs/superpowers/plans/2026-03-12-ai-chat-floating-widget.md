# AI Coach Floating Chat Widget Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the AI coach as a persistent floating chatbot widget (bottom-right) on the plan page, while keeping the accordion panel as a read-only coaching history.

**Architecture:** Add `chatOpen` + `hasUnread` state to the existing plan page. Add fixed-position widget JSX at the bottom of the page's JSX tree — shares all existing AI state (no extraction). Simplify the accordion body to history-only (chatMessages). All new CSS uses existing design tokens.

**Tech Stack:** React 19, TypeScript, Next.js 16 App Router, existing CSS token system (`--d-orange`, `--d-raised`, etc.)

**Spec:** `docs/superpowers/specs/2026-03-12-ai-chat-floating-widget-design.md`

**Verification:** `npm run typecheck && npm run lint` — dev server at http://localhost:3001

---

## Chunk 1: State + CSS + Pill Button

### Task 1: Add chatOpen and hasUnread state

**Files:**
- Modify: `src/app/plans/[id]/page.tsx` (near line 460, after existing AI state)

- [ ] **Step 1.1: Add the two new state variables**

After line 460 (`const aiTrainerApplying = aiTrainerApplyingTarget !== null;`), add:

```typescript
const [chatOpen, setChatOpen] = useState(false);
const [hasUnread, setHasUnread] = useState(false);
```

- [ ] **Step 1.2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 1.3: Commit**

```bash
git add src/app/plans/[id]/page.tsx
git commit -m "feat: add chatOpen and hasUnread state for floating widget"
```

---

### Task 2: Add floating widget CSS

**Files:**
- Modify: `src/app/plans/plans.css` (append at end of file)

- [ ] **Step 2.1: Append widget CSS to plans.css**

Add at the very end of `src/app/plans/plans.css`:

```css
/* ─── Floating AI Coach Widget ───────────────────────────────────────── */

.ai-widget {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

/* Pill button (closed state) */
.ai-widget-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--d-orange);
  color: #fff;
  border: none;
  border-radius: 24px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(252, 76, 2, 0.35);
  transition: box-shadow 0.15s, transform 0.1s;
  position: relative;
}

.ai-widget-pill:hover {
  box-shadow: 0 6px 20px rgba(252, 76, 2, 0.45);
  transform: translateY(-1px);
}

.ai-widget-pill:active {
  transform: translateY(0);
}

.ai-widget-unread-dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #fff;
}

/* Chat panel (open state) */
.ai-widget-panel {
  width: 360px;
  max-height: 520px;
  background: var(--d-raised);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--d-border);
}

/* Panel header */
.ai-widget-header {
  background: var(--d-orange);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.ai-widget-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.ai-widget-header-subtitle {
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  font-weight: 400;
}

.ai-widget-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-widget-header-btn {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  border-radius: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  transition: background 0.1s;
}

.ai-widget-header-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

/* Message thread */
.ai-widget-thread {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.ai-widget-thread-empty {
  color: var(--d-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px 12px;
  line-height: 1.5;
}

/* Message bubbles */
.ai-widget-bubble {
  max-width: 88%;
  padding: 8px 11px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.ai-widget-bubble--coach {
  background: var(--d-bg);
  color: var(--d-text);
  border: 1px solid var(--d-border);
  border-top-left-radius: 4px;
  align-self: flex-start;
  border-left: 3px solid var(--d-orange);
}

.ai-widget-bubble--athlete {
  background: var(--d-orange);
  color: #fff;
  border-top-right-radius: 4px;
  align-self: flex-end;
}

.ai-widget-bubble--system {
  background: transparent;
  color: var(--d-muted);
  font-size: 11px;
  text-align: center;
  align-self: center;
  max-width: 100%;
  padding: 2px 0;
  border: none;
}

.ai-widget-bubble-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
  opacity: 0.65;
}

/* Proposal block inside widget */
.ai-widget-proposal {
  border-top: 1px solid var(--d-border);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--d-bg);
  flex-shrink: 0;
}

.ai-widget-proposal-reply {
  font-size: 13px;
  color: var(--d-text);
  line-height: 1.5;
}

.ai-widget-proposal-followup {
  font-size: 12px;
  color: var(--d-muted);
  font-style: italic;
}

.ai-widget-proposal-changes {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ai-widget-proposal-change {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--d-text);
}

.ai-widget-proposal-change-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--d-orange);
  flex-shrink: 0;
}

.ai-widget-proposal-change-label {
  flex: 1;
}

.ai-widget-proposal-apply-one {
  font-size: 11px;
  padding: 2px 8px;
  flex-shrink: 0;
  background: var(--d-orange);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
}

.ai-widget-proposal-apply-one:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-widget-proposal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-widget-proposal-details-toggle {
  font-size: 11px;
  color: var(--d-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  margin-left: auto;
}

/* Input row */
.ai-widget-input-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--d-border);
  background: var(--d-raised);
  flex-shrink: 0;
  align-items: flex-end;
}

.ai-widget-input {
  flex: 1;
  border: 1px solid var(--d-border);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  background: var(--d-bg);
  color: var(--d-text);
  resize: none;
  outline: none;
  min-height: 36px;
  max-height: 96px;
  line-height: 1.4;
}

.ai-widget-input:focus {
  border-color: var(--d-orange);
}

.ai-widget-input::placeholder {
  color: var(--d-muted);
}

.ai-widget-send-btn {
  background: var(--d-orange);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.ai-widget-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-widget-error {
  font-size: 11px;
  color: #e53e3e;
  padding: 4px 12px 6px;
  flex-shrink: 0;
}

/* Mobile: full-width tray */
@media (max-width: 640px) {
  .ai-widget {
    bottom: 0;
    right: 0;
    left: 0;
    align-items: stretch;
  }

  .ai-widget-pill {
    border-radius: 16px 16px 0 0;
    justify-content: center;
    box-shadow: 0 -4px 16px rgba(252, 76, 2, 0.2);
  }

  .ai-widget-panel {
    width: 100%;
    max-height: 70vh;
    border-radius: 16px 16px 0 0;
    border-bottom: none;
  }
}
```

- [ ] **Step 2.2: Typecheck (CSS only — verify build compiles)**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/app/plans/plans.css
git commit -m "feat: add floating AI coach widget CSS"
```

---

## Chunk 2: Widget JSX + Accordion Simplification

### Task 3: Add the floating widget JSX to page.tsx

The widget goes at the very bottom of the page JSX, just before the final closing tag of the main layout div. Find the line that contains `{/* end pcal-layout */}` or the closing `</div>` of `<div className="pcal-layout...">`.

**Files:**
- Modify: `src/app/plans/[id]/page.tsx`

- [ ] **Step 3.1: Locate the exact insertion point**

The insertion point is **after line 2909** in `src/app/plans/[id]/page.tsx` — after both closing `</div>` tags that close the pcal-layout (line 2908) and its outer wrapper (line 2909), and just before the `{/* Activity detail modal */}` comment on line 2911. Confirm with:

```bash
sed -n '2905,2915p' src/app/plans/[id]/page.tsx
```

Expected output shows:
```
        </aside>          ← line 2907
      </div>              ← line 2908 — closes pcal-layout (PLD)
      </div>              ← line 2909 — closes outer wrapper
                          ← line 2910 (blank)
      {/* Activity detail modal */}  ← line 2911
```

Insert the widget block between line 2909 and line 2911 (the blank line gap).

- [ ] **Step 3.2: Add a threadRef for auto-scroll**

At the top of the component, near other refs (search for `useRef` around line 520), add:

```typescript
const widgetThreadRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3.3: Add auto-scroll useEffect**

After the `hasUnread` state declaration (added in Task 1), add:

```typescript
// Auto-scroll widget thread to bottom when new messages arrive
useEffect(() => {
  if (chatOpen && widgetThreadRef.current) {
    widgetThreadRef.current.scrollTop = widgetThreadRef.current.scrollHeight;
  }
}, [aiChatTurns, chatOpen]);
```

- [ ] **Step 3.4: Add the floating widget JSX at the insertion point**

Insert the following after line 2909 (before the Activity detail modal comment):

```tsx
{/* ─── Floating AI Coach Widget ─────────────────────────────────── */}
{planId && (
  <div className="ai-widget">
    {chatOpen ? (
      <div className="ai-widget-panel">
        {/* Header */}
        <div className="ai-widget-header">
          <div className="ai-widget-header-title">
            <span>🏃</span>
            <div>
              <div>AI Coach</div>
              <div className="ai-widget-header-subtitle">Plan adjustments &amp; advice</div>
            </div>
          </div>
          <div className="ai-widget-header-actions">
            <button
              type="button"
              className="ai-widget-header-btn"
              onClick={() => { setChatOpen(false); }}
              title="Minimise"
            >
              —
            </button>
            <button
              type="button"
              className="ai-widget-header-btn"
              onClick={clearAiChat}
              disabled={aiTrainerLoading || aiTrainerApplying}
              title="Clear chat"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Message thread */}
        <div className="ai-widget-thread" ref={widgetThreadRef}>
          {aiChatTurns.length === 0 ? (
            <p className="ai-widget-thread-empty">
              Tell me what changed this week — a missed session, travel, or fatigue — and I&apos;ll adjust your plan.
            </p>
          ) : (
            aiChatTurns.map((turn) => (
              <div
                key={turn.id}
                className={`ai-widget-bubble ai-widget-bubble--${turn.role}`}
              >
                <div className="ai-widget-bubble-label">
                  {turn.role === 'athlete' ? 'You' : turn.role === 'coach' ? 'Coach' : ''}
                </div>
                {turn.proposalState === 'applied' ? (
                  <span style={{ opacity: 0.6, fontStyle: 'italic' }}>
                    Suggestion applied{turn.createdAt ? ` — ${new Date(turn.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                  </span>
                ) : (
                  humanizeAiText(turn.text, aiChangeLookup)
                )}
              </div>
            ))
          )}
        </div>

        {/* Active proposal block */}
        {aiTrainerProposal && (
          <div className="ai-widget-proposal">
            <p className="ai-widget-proposal-reply">
              {humanizeAiText(aiTrainerProposal.coachReply, aiChangeLookup)}
            </p>
            {aiTrainerProposal.followUpQuestion && (
              <p className="ai-widget-proposal-followup">
                {humanizeAiText(aiTrainerProposal.followUpQuestion, aiChangeLookup)}
              </p>
            )}
            {aiTrainerProposal.changes.length > 0 && (
              <div className="ai-widget-proposal-changes">
                {aiTrainerProposal.changes.map((change, i) => (
                  <div key={i} className="ai-widget-proposal-change">
                    <span className="ai-widget-proposal-change-dot" />
                    <span className="ai-widget-proposal-change-label">
                      {humanizeAiText(change.reason, aiChangeLookup)}
                    </span>
                    <button
                      type="button"
                      className="ai-widget-proposal-apply-one"
                      onClick={() => applyAiAdjustment(i)}
                      disabled={aiTrainerLoading || aiTrainerApplying}
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="ai-widget-proposal-actions">
              {aiTrainerProposal.changes.length > 1 && (
                <button
                  type="button"
                  className="dash-btn-primary"
                  style={{ fontSize: '12px', padding: '5px 12px' }}
                  onClick={() => applyAiAdjustment()}
                  disabled={aiTrainerLoading || aiTrainerApplying}
                >
                  Apply all
                </button>
              )}
              <button
                type="button"
                className="ai-widget-proposal-details-toggle"
                onClick={() => setProposalDetailsOpen((p) => !p)}
              >
                {proposalDetailsOpen ? '▾ Hide details' : '▸ Show details'}
              </button>
            </div>
            {proposalDetailsOpen && aiTrainerProposal.riskFlags && aiTrainerProposal.riskFlags.length > 0 && (
              <ul style={{ fontSize: '11px', color: 'var(--d-muted)', paddingLeft: '16px', margin: 0 }}>
                {aiTrainerProposal.riskFlags.map((flag, i) => (
                  <li key={i}>⚠ {flag}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Input row */}
        <div className="ai-widget-input-row">
          <textarea
            className="ai-widget-input"
            value={aiTrainerInput}
            onChange={(e) => setAiTrainerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void generateAiAdjustment();
              }
            }}
            placeholder="Ask your coach…"
            rows={1}
            disabled={aiTrainerLoading || aiTrainerApplying}
          />
          <button
            type="button"
            className="ai-widget-send-btn"
            onClick={() => void generateAiAdjustment()}
            disabled={aiTrainerLoading || aiTrainerApplying || !aiTrainerInput.trim()}
          >
            {aiTrainerLoading ? '…' : 'Send'}
          </button>
        </div>
        {aiTrainerError && <p className="ai-widget-error">{aiTrainerError}</p>}
      </div>
    ) : null}

    {/* Pill button — always visible */}
    <button
      type="button"
      className="ai-widget-pill"
      onClick={() => { setChatOpen(true); setHasUnread(false); }}
    >
      🏃 Coach
      {hasUnread && <span className="ai-widget-unread-dot" />}
    </button>
  </div>
)}
```

- [ ] **Step 3.3: Typecheck**

```bash
npm run typecheck
```

Fix any errors. Common issues: `humanizeAiText` or `aiChangeLookup` not in scope at the widget location — the widget JSX is inside the same component so they should be available.

- [ ] **Step 3.4: Commit**

```bash
git add src/app/plans/[id]/page.tsx
git commit -m "feat: add floating AI coach widget JSX"
```

---

### Task 4: Wire hasUnread — set when coach message arrives while widget is closed

The `hasUnread` dot should light up when a new coach message is appended to `aiChatTurns` while `chatOpen === false`.

**Files:**
- Modify: `src/app/plans/[id]/page.tsx`

- [ ] **Step 4.1: Find where coach turns are appended to aiChatTurns**

```bash
grep -n "setAiChatTurns\|aiChatTurns.*prev\|push.*turn\|role.*coach" src/app/plans/[id]/page.tsx | head -20
```

Look for `setAiChatTurns((prev) => [...prev, newTurn])` or similar patterns where a coach turn is added.

- [ ] **Step 4.2: Add setHasUnread(true) after each coach turn append**

For each place where a coach turn (role `'coach'`) is appended to `aiChatTurns`, add immediately after:

```typescript
// Notify user of new coach message if widget is closed
if (!chatOpen) setHasUnread(true);
```

Also do the same when `chatMessages` gains a new coach message (in the drag/drop and edit session end handlers that call `setChatMessages`):

```typescript
setChatMessages((prev) => [...prev, data.coachMessage]);
if (!chatOpen) setHasUnread(true);  // ← add this line after each setChatMessages call that adds a coach message
```

- [ ] **Step 4.3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4.4: Commit**

```bash
git add src/app/plans/[id]/page.tsx
git commit -m "feat: show unread dot on widget pill when coach responds while closed"
```

---

### Task 5: Simplify accordion to history-only

**Files:**
- Modify: `src/app/plans/[id]/page.tsx` (around lines 1958-2170)

- [ ] **Step 5.1: Change accordion summary label**

Find:
```tsx
<summary className="pcal-inline-panel-summary">AI Trainer</summary>
```
Replace with:
```tsx
<summary className="pcal-inline-panel-summary">Coach History</summary>
```

- [ ] **Step 5.2: Replace the accordion body with history-only content**

Find the accordion body — from `<div className="pcal-inline-panel-body">` to its closing `</div>` (immediately before `</details>`). Replace the entire inner `<section className="pcal-ai-trainer pcal-ai-trainer-chat">...</section>` with:

```tsx
<div className="pcal-inline-panel-body">
  <div className="pcal-ai-history">
    {chatMessages.length === 0 ? (
      <p className="pcal-ai-trainer-status">Your coaching conversations will appear here.</p>
    ) : (
      chatMessages.map((msg) => (
        <article key={msg.id} className={`pcal-ai-turn role-${msg.role}`}>
          <div className="pcal-ai-turn-head">
            <strong>
              {msg.role === 'athlete' ? 'You' : msg.role === 'coach' ? 'Coach' : 'System'}
            </strong>
            {msg.metadata?.state && msg.metadata.state !== 'active' && (
              <span className={`pcal-ai-turn-state state-${msg.metadata.state}`}>
                {msg.metadata.state === 'applied' ? 'Applied' : 'History'}
              </span>
            )}
          </div>
          <p>{msg.content}</p>
        </article>
      ))
    )}
  </div>
</div>
```

- [ ] **Step 5.3: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Fix any errors. If unused variables are flagged (e.g., state that was only used in the now-removed accordion input), remove them — but verify they are not used in the floating widget before removing.

- [ ] **Step 5.4: Commit**

```bash
git add src/app/plans/[id]/page.tsx
git commit -m "feat: simplify accordion to history-only (Coach History)"
```

---

### Task 6: Final verification

- [ ] **Step 6.1: Full typecheck + lint + build**

```bash
npm run typecheck && npm run lint && npm run build
```

All must pass with zero errors.

- [ ] **Step 6.2: Visual verification in browser**

Navigate to http://localhost:3001/plans/PLAN_ID

Check:
1. Orange "🏃 Coach" pill appears bottom-right at all times
2. Clicking pill opens the chat panel with orange header
3. Existing chat turns display as bubbles
4. Typing in input + Enter or Send button triggers AI generation
5. When AI responds, coach bubble appears in thread
6. When a proposal is active, changes list + Apply buttons visible in panel
7. Clicking ✕ closes panel, pill remains
8. Green unread dot appears on pill when coach replies while panel is closed
9. Tapping pill again clears the dot
10. "Coach History" accordion shows DB chat history, no input box
11. Dark mode: panel background dark, text readable, orange header unchanged
12. Mobile (≤640px): pill anchors to bottom edge, panel is full-width tray

- [ ] **Step 6.3: Final commit if needed**

```bash
git add -A
git commit -m "feat: AI coach floating chat widget — complete"
git push origin main
```
