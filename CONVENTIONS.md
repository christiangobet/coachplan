# CoachPlan — UI & Code Conventions

> This file is the authoritative reference for design decisions, component patterns, and coding conventions.
> All AI tools (Claude Code, Codex, Cursor, Gemini, etc.) should read this before making UI changes.

---

## Visual Design System

### Aesthetic
Strava-inspired: energetic, athletic, data-dense but clean.
- Font: **Figtree** (all weights)
- Accent: **#fc4c02** (Strava orange) → `--d-orange`
- Background: light gray `--d-bg`
- Cards: white `--d-raised`
- Borders: `--d-border` (standard), `--d-border-light` (subtle)

### CSS Tokens (defined in `src/app/dashboard/dashboard.css`)
```
--d-orange          #fc4c02
--d-orange-soft     rgba(252,76,2,0.08)
--d-green           ~#0f8a47
--d-red             red (missed/error)
--d-red-soft        rgba(red,0.08)
--d-text            dark near-black
--d-text-mid        medium gray
--d-muted           light gray
--d-bg              page background
--d-raised          white / card surface
--d-border          standard border
--d-border-light    subtle separator
--d-space-*         spacing scale
```

`dashboard.css` is imported by both the dashboard and calendar pages — it is the shared base.

### Responsive Breakpoints
| Breakpoint | Width   | Behavior |
|---|---|---|
| Desktop     | >1080px | 3-col grid (sidebar + main + right panel) |
| Tablet      | ≤1080px | 2-col (sidebar hidden) |
| Mobile      | ≤768px  | 1-col, static right panel |
| Small mobile| ≤640px  | Calendar grid min-width, compact cells |
| iPhone 13   | ≤480px  | Single-col fields, reduced padding in cards |

---

## Component Conventions

### Activity Type Badges
- Pill-shaped, color-coded: RUN=orange, STR=purple, XT=blue, RST=green
- Classes: `cal-activity-code type-{type}` (calendar), `dash-type-badge type-{type}` (dashboard)
- Show abbreviations only inside compact cells (RUN, STR, XT, RST…)

### Completion Indicators
- **Per-activity inside cell chip:** 7px green dot inline, right of type badge → `.cal-activity-done-dot`
- **Whole-day cell header:** 16px green circle with ✓ tick → `.cal-day-check`
- **Day detail panel:** green pill badge "✓ Done" → `.cal-detail-badge.status-done`
- **Never** use "Done" text labels inside compact activity chips

### Cards
- Default to **collapsed**; only render when triggered by user action (e.g. URL param, click)
- After a save/complete action → redirect to collapse the card (strip the trigger param)
- Padding: `14px 20px` desktop → `10px 14px` at ≤480px
- Date header inside day card: `font-size: 18px; font-weight: 800` — primary visual anchor

### Workout Row (inside day card)
- Orange tint background: `rgba(252, 76, 2, 0.045)`
- Border-radius: 8px; padding: `10px 12px`
- Activity title: 16px / 700 (desktop), 14px (mobile)
- Description: 2-line clamp (`-webkit-line-clamp: 2`)

### Log Forms
- Desktop: 2-col grid (Distance + Duration side-by-side), Pace full-width, Save button full-width
- Mobile ≤480px: single column for all fields
- Classes: `dash-log-fields`, `dash-log-field`, `dash-btn-primary`

### Buttons
| Class | Use |
|---|---|
| `dash-btn-primary` | Orange fill CTA |
| `dash-btn-ghost` | Secondary / outline |
| `dash-btn-ghost dash-btn-missed` | Destructive (red text) |

- In sidebar cards: stack buttons vertically, full-width (`flex-direction: column` on `.dash-log-actions`)

---

## Page-Specific Decisions

### Dashboard (`/dashboard`)
- Hero "Up Next" card: type badge is **inline with** the workout title (not floating alone)
- Status text is color-coded: done=green, missed=red, open=orange
- `rawText` detail renders as an orange pill, not a gray box
- "Need to adapt?" chips are separated from action buttons by a `border-top`

### Training Log (`/calendar`)
- Day details card hidden by default; only renders when `?date=` param is in URL (`hasSelectedDate`)
- After marking done/missed/reopen → redirect to URL without `date` param (collapses card)
- Card section order: date header → per-activity (workout row + log form each paired) → Strava logs → day buttons
- Each activity's log form sits **directly below its own workout row** (not grouped separately at the bottom)
- Strava "Sync Day Log" button shown in Logged Activities header only when `stravaAccount` exists

---

## Key Files
| File | Purpose |
|---|---|
| `src/app/dashboard/dashboard.css` | Shared design tokens + all `dash-*` classes |
| `src/app/calendar/calendar.css` | Calendar grid + day-details card styles |
| `src/app/calendar/page.tsx` | Training Log server component |
| `src/app/dashboard/page.tsx` | Dashboard server component |
| `src/components/DayCompletionButton.tsx` | Day done/missed/reopen — has `successRedirectHref` prop |
| `src/components/CalendarActivityLogger.tsx` | Per-activity log form |
| `src/components/StravaDaySyncButton.tsx` | Strava sync pill button |
| `prisma/schema.prisma` | Database schema |

---

## Coding Conventions

- **No auto-commits** — only commit when explicitly asked
- **No unrequested refactors** — stay minimal and focused
- **Screenshot after every visual change** to verify before moving on
- API routes: `src/app/api/` — use `auth()` for auth, `@/lib/prisma` for DB
- Server components use `currentUser()` from Clerk; API routes use `auth()`
- `successRedirectHref` props on client components handle post-save navigation (server decides destination)
- Mobile: always verify at 390px (iPhone 13) after layout changes
