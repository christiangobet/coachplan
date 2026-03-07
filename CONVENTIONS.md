# MyTrainingPlan — UI & Code Conventions

This is the implementation-facing UI convention file for current app behavior.
Use this with `AI_DESIGN_RULES.md` before changing UI.

---

## Visual system

- Primary font: `Figtree`
- Accent: `#fc4c02` (`--d-orange`)
- Surfaces: light gray app background + white cards
- Tokens are centralized in `src/app/dashboard/dashboard.css`

Core tokens:
- `--d-bg`, `--d-raised`, `--d-border`, `--d-border-light`
- `--d-text`, `--d-text-mid`, `--d-muted`
- `--d-orange`, `--d-green`, `--d-red`, `--d-amber`
- `--d-space-*`, `--d-radius*`, `--d-shadow*`

---

## Responsive layout model (current)

### Dashboard shell (`.dash-grid`)
- Large desktop: `minmax(220px,232px) 1fr minmax(260px,300px)`
- <=1380px: 2-column (`left + center`), right hidden
- <=768px: single-column; left/right panes hidden

### Calendar (`/calendar`)
- Base desktop: 2-column (`left + center`)
- Desktop with selected day: 3-column (`left + center + right day panel`)
- <=900px: single-column (left hidden)

### Plan view (`/plans/[id]`)
- Base desktop: 2-column (`left + main`)
- Day panel: fixed right slide panel on desktop
- <=900px: day panel becomes full-screen-style overlay

### Strava import (`/strava`)
- Desktop: 2-column (`left + center`)
- <=900px: single-column, with inline mobile sync panel

### iPhone baseline
- Validate at `390px` width (iPhone 13 baseline) for every layout change.

---

## Day/detail panel conventions

- Selected day panel must be immediately legible on mobile (full-height overlay behavior where implemented).
- On desktop plan view, clicking outside both day cells and right panel closes the selected day panel.
- Keep planned metrics and logged metrics visually distinct.

Distance display rule (compact contexts):
- Planned-only: prefix with `P:`
- Planned + logged: show compact progression (`planned -> logged`)
- Round distance display to 1 decimal where compact

---

## Activity and status conventions

- Activity type abbreviations are canonical (`RUN`, `STR`, `XT`, `RST`, `MOB`, `YOG`, `HIK`, `OTH`).
- Completion/status must be represented consistently across dashboard, calendar, and plan day views.
- Strava-origin entries should include provider icon treatment consistent with shared icon components.

---

## Branding conventions

Use `BrandLogo` for app branding instead of inline text logos.

Assets:
- `/public/branding/mytrainingplan-logo-full.png`
- `/public/branding/mytrainingplan-logo-mark.png`

Component:
- `src/components/BrandLogo.tsx`
- `src/components/BrandLogo.module.css`

---

## Key files

- `src/app/dashboard/dashboard.css` — global tokens + shared dashboard/calendar primitives
- `src/app/calendar/calendar.css` — calendar-specific layout and day panel behavior
- `src/app/plans/plans.css` — plans list/detail/day-panel behavior
- `src/app/strava/strava.css` — strava import responsive behavior
- `src/components/BrandLogo.tsx` — canonical logo rendering

---

## Engineering guardrails

- No unrequested visual rewrites.
- Keep changes local and reversible.
- Preserve existing flows unless explicitly asked.
- Re-check accessibility/focus/contrast for changed controls.
- For UI changes, include desktop + 390px verification before completion.
