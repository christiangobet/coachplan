# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/coachplan/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** CoachPlan
**Updated:** 2026-03-15
**Category:** Endurance Sports SaaS — Athlete Training Management

---

## Color Palette

| Role | Hex | CSS Token | Usage |
|------|-----|-----------|-------|
| Accent / Brand | `#fc4c02` | `--d-orange` | CTAs, highlights, Strava brand |
| Success / Completion | `#0f8a47` | `--d-green` | Done states, streaks, health |
| Background | light gray | `--d-bg` | Page background |
| Card surface | white | `--d-raised` | Cards, panels |
| Body text | — | `--d-text` | Primary readable text |
| Muted text | — | `--d-muted` | Subtitles, metadata |
| Mid text | — | `--d-text-mid` | Secondary labels |
| Border (strong) | — | `--d-border` | Card borders, dividers |
| Border (light) | — | `--d-border-light` | Subtle separators |
| Orange tint row | `rgba(252,76,2,0.045)` | — | Workout row backgrounds |

**Always use CSS tokens** (`var(--d-orange)` etc.) — never hardcode hex values.

---

## Typography

- **Font family:** Figtree (all weights)
- **Body text:** `--d-text`; muted = `--d-muted`; mid = `--d-text-mid`
- **Date headers in day card:** 18px / 800 weight — visually dominant
- **Min body font size on mobile:** 16px

---

## Target Platforms

**Primary:** Apple ecosystem — macOS (MacBook) and iOS (iPhone, various sizes)
- Browsers: Safari on macOS + Safari on iOS (not Chrome-first)
- Retina displays: use `@2x` assets, `image-rendering: -webkit-optimize-contrast`
- Test on: iPhone SE (375px), iPhone 13/14 (390px), iPhone Pro Max (430px), MacBook (1280–1440px)

## Breakpoints

| Label | Width | Device |
|-------|-------|--------|
| Desktop | 1200px | MacBook |
| Tablet landscape | 960px | iPad landscape |
| Tablet | 768px | iPad portrait |
| Mobile large | 640px | — |
| Mobile (iPhone 14/13) | 390px | Primary mobile target |
| Mobile (iPhone SE) | 375px | Smallest supported |

---

## Layout Conventions

- **Cards collapsed by default** — expand only on explicit interaction
- After save → redirect to collapse the card (not refresh in place)
- Compact spacing on mobile (≤480px): reduce padding, single-col fields
- Activity log fields: 2-col on desktop (distance + duration), pace full-width; 1-col on mobile
- Day completion buttons: stacked full-width in sidebar card

---

## Component Specs

### Activity Chips
- No "Done" text labels — use a small **green dot** inline right of the badge

### Day Completion
- Whole-day completion = green circle with ✓ tick (`.cal-day-check`)

### Workout Rows
- Background: `rgba(252,76,2,0.045)` (orange tint)

### Buttons
```css
/* Primary CTA */
.btn-primary {
  background: var(--d-orange);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
.btn-primary:hover { opacity: 0.9; }

/* Success / Completion */
.btn-success {
  background: var(--d-green);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
```

### Cards
```css
.card {
  background: var(--d-raised);
  border: 1px solid var(--d-border);
  border-radius: 12px;
  padding: 24px;
  transition: box-shadow 200ms ease;
}
.card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
```

### Inputs
```css
.input {
  padding: 10px 14px;
  border: 1px solid var(--d-border);
  border-radius: 8px;
  font-size: 16px;
  font-family: Figtree, sans-serif;
  transition: border-color 200ms ease;
}
.input:focus {
  border-color: var(--d-orange);
  outline: none;
  box-shadow: 0 0 0 3px rgba(252,76,2,0.15);
}
```

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 4px | Tight gaps |
| `--space-sm` | 8px | Icon gaps |
| `--space-md` | 16px | Standard padding |
| `--space-lg` | 24px | Section padding |
| `--space-xl` | 32px | Large gaps |
| `--space-2xl` | 48px | Section margins |

---

## Style Guidelines

- **Mode:** Light + Dark (CSS tokens switch automatically via `prefers-color-scheme` or user toggle)
- **Light mode:** white cards (`--d-raised`) on light gray bg (`--d-bg`); body text `--d-text`
- **Dark mode:** dark cards on dark bg; maintain 4.5:1 contrast; borders must remain visible (`--d-border`)
- **Never hardcode light-only colors** — always use CSS tokens so dark mode works
- **Mood:** Athletic, clean, data-forward, trustworthy
- **Density:** Medium-compact — athletes want information density, not marketing whitespace
- **Transitions:** 150–300ms for micro-interactions; use `transform`/`opacity` not `width`/`height`
- **Avoid:** Dark backgrounds, heavy gradients, emoji icons, decorative animations

---

## Apple / Safari-Specific Rules

### iOS Safari quirks — always apply
- **Viewport height:** use `100dvh` not `100vh` — `100vh` includes the browser chrome on iOS and causes overflow
- **Input zoom prevention:** all inputs must have `font-size: 16px` minimum — iOS Safari auto-zooms on inputs < 16px
- **Safe area insets:** use `env(safe-area-inset-*)` for bottom nav / fixed footers (notch, Dynamic Island, home indicator)
  ```css
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  ```
- **Tap delay:** add `touch-action: manipulation` to all interactive elements to eliminate 300ms delay
- **Momentum scroll:** use `-webkit-overflow-scrolling: touch` on scroll containers
- **Overscroll:** add `overscroll-behavior: contain` on inner scroll areas to prevent accidental pull-to-refresh
- **Backdrop blur:** `-webkit-backdrop-filter` required alongside `backdrop-filter` for Safari

### Touch targets (iPhone)
- **Minimum 44×44px** for all tappable elements (`min-height: 44px; min-width: 44px`)
- **8px minimum gap** between adjacent touch targets
- **No hover-only interactions** — hover doesn't exist on touch; all info/actions must be tap-accessible
- Use `click`/`tap` for primary actions, never `mouseenter` as the only trigger

### macOS Safari
- Test `:focus-visible` behaviour — Safari handles focus rings differently from Chrome
- `backdrop-filter: blur()` performs well on Apple Silicon — safe to use
- Scrollbar styling: `-webkit-scrollbar` for custom scrollbars (standard `scrollbar-width` not fully supported)

## Anti-Patterns (Do NOT Use)

- ❌ Emojis as icons — use SVG icons (Lucide, Heroicons)
- ❌ Missing `cursor: pointer` on clickable elements
- ❌ Layout-shifting hover transforms (scale)
- ❌ Low-contrast text (min 4.5:1)
- ❌ Instant state changes — always transition 150–300ms
- ❌ Invisible focus states
- ❌ Hardcoded hex colors — always use CSS tokens
- ❌ Refreshing page in-place after save — redirect to collapse instead

---

## Pre-Delivery Checklist

- [ ] No emojis as icons (SVG only)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Text contrast ≥ 4.5:1 in **both** light and dark modes
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 390px, 430px, 768px, 1200px (Apple-first)
- [ ] No horizontal scroll on mobile
- [ ] `100dvh` used (not `100vh`) for full-height elements
- [ ] All inputs `font-size ≥ 16px` (prevent iOS zoom)
- [ ] `touch-action: manipulation` on interactive elements
- [ ] Safe area insets applied to fixed bottom elements
- [ ] Tested on Safari (macOS + iOS) — not just Chrome
- [ ] Cards collapsed by default
- [ ] CSS tokens used throughout (never hardcoded hex)
