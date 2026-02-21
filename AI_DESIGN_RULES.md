# AI Design Rules (CoachPlan)

Purpose:
This file defines the UX/UI standards and decision process for CoachPlan.
Codex must follow this process before making UI changes. When in doubt, ask clarifying questions.

Non-negotiables:
- Do NOT change or “simplify” the plan parsing system prompts (e.g., v4_master / V4 parsing prompts) unless explicitly asked.
- Do NOT refactor UI purely for aesthetics if it increases cognitive load or breaks flows.
- Prefer small, reversible changes behind feature flags where feasible.

## 1) Operating Mode (IMPORTANT)
When I give UI/UX feedback, do NOT immediately implement.
Instead, follow this sequence:

1) Restate the goal and user segment:
   - Who is the user (athlete/coach/admin)?
   - What job are they trying to do?
   - What screen + flow is affected?

2) Identify the UX problem type:
   - Navigation/IA, comprehension, friction, trust, accessibility, performance, visual hierarchy, state clarity, error recovery.

3) Provide an expert assessment:
   - What’s likely happening today (user confusion, dead-ends, weak affordances)?
   - What’s the risk if we implement my suggestion literally?
   - What alternatives exist?

4) Propose 2–3 options with trade-offs:
   - Option A: minimal change (fast, low risk)
   - Option B: best practice (balanced)
   - Option C: bolder redesign (higher risk)
   For each option include: impact, effort, risk, and what to measure.

5) Recommend one option + a concrete plan:
   - Step-by-step changes
   - Files/components likely touched
   - Any required copy changes
   - Analytics events to validate improvement

Only after steps 1–5, proceed to implementation.

## 2) UX Principles (Heuristics we optimize for)
- Clarity over cleverness: user always knows “Where am I?”, “What can I do?”, “What happened?”
- Progressive disclosure: show only what’s needed now; keep advanced controls available but not dominant.
- Strong visual hierarchy: 1 primary action per screen; secondary actions are visually quieter.
- State-first UI: loading/empty/error/success states are designed intentionally and consistently.
- Trust & correctness: parsing and sync (Strava/Garmin) must communicate confidence and allow review/undo.
- Speed: perceived performance matters (skeletons, optimistic UI where safe).
- Accessibility: keyboard navigation, focus rings, color contrast, aria labels, form errors tied to inputs.

## 3) Layout & Design System Rules (Practical)
- Use consistent spacing scale (e.g., 4/8/12/16/24/32).
- Use consistent typography scale:
  - Page title, section title, body, caption.
- Buttons:
  - Primary = one per view (the main “next step”)
  - Secondary = supportive actions
  - Destructive = rare + confirmation
- Forms:
  - Labels always visible (not placeholder-only)
  - Inline validation + clear error text
  - Preserve user input on error
- Tables/lists:
  - Support scanning: alignment, zebra optional, strong headers
  - Provide empty states with a “next action”
- Modals:
  - Only for short, high-confidence actions
  - Avoid modal chains (modal -> modal)
- Notifications:
  - Use toasts for confirmations, not for critical errors
  - Critical errors should be inline + actionable

## 4) Key Flows (Do not degrade)
These flows must remain fast and obvious:
1) Upload plan PDF -> Parse -> Review -> Publish -> Calendar visible
2) Daily logging -> Complete workout/day -> Progress reflects it
3) Strava/Garmin connect -> Sync -> Match -> Confirm/resolve conflicts
4) Coach assignment -> Athlete access -> Shared plan visibility

If changing any UI in these flows:
- explicitly list what screen states are impacted
- ensure error recovery is better than today (never worse)

## 5) UI Review Checklist (Use before finalizing changes)
- Visual hierarchy: is the primary action unmistakable?
- Copy: does the user understand what happens next?
- States: loading/empty/error covered?
- Consistency: patterns match other pages?
- Accessibility: keyboard + aria + focus?
- Mobile: does it still work at small widths?
- Regression risk: what could break (especially parsing/review/sync)?

## 6) Measurement (What to instrument)
For any UX change, propose events like:
- plan_upload_started / plan_upload_succeeded / plan_parse_failed
- plan_review_opened / plan_published
- integration_connected / sync_started / sync_conflict / sync_resolved
- workout_completed / day_completed
Also propose 1 success metric (conversion, completion rate, time-to-task, error rate).

## 7) Implementation Guardrails
- Prefer local, component-level changes.
- Avoid sweeping redesign PRs.
- Keep diff readable; explain intent in PR description.
- Add screenshots (before/after) for UI PRs.
