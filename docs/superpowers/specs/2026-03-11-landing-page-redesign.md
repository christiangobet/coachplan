# Landing Page Redesign — Design Spec
**Date:** 2026-03-11
**Status:** Approved

---

## Overview

Full redesign of `mytrainingplan.io` landing page. The current page has solid copy but reads as an early-stage MVP — weak social proof, no "How it works", generic hero image, no pricing clarity. The redesign makes it feel premium, athletic, and conversion-optimised.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Visual direction | **Dark Premium** | Navy base, orange accents, high contrast. Athletic and modern — consistent with Strava integration branding. |
| Primary audience | **Athletes first** | Hero speaks to someone with a PDF plan who wants to race. Coaches are secondary mention. |
| Layout | **Split Hero** | Left copy + right app mockup. Classic SaaS pattern with proven conversion. |
| How It Works | **3-step numbered flow** | Upload PDF → Set race date → Execute daily. Highest ROI missing section. |
| Social proof | **Placeholder testimonials** | 3 quotes (2 athletes, 1 coach). Replace with real users post-launch. |
| Pricing clarity | **"Free to start · No credit card"** | Kills the biggest conversion blocker. Added to CTA section. |
| Mobile | **Primary viewport** | App has strong mobile usage. Stacked layout, full-width CTAs, app mockup below hero copy. |

---

## Page Structure

### 1. Navigation (sticky)
- Left: logo mark + "MyTrainingPlan" wordmark
- Right: ghost "Sign in" + primary "Create account →" CTA
- Background: `rgba(7,12,22,0.85)` + `backdrop-filter: blur(12px)` on scroll
- Stays minimal — no nav links

### 2. Hero Section
**Desktop (≥768px):** 2-column grid — left copy, right app mockup
**Mobile (<768px):** Stacked — copy → full-width app mockup → social proof pills

**Left copy:**
- Eyebrow pill: "For endurance athletes" (orange tint, uppercase)
- H1: "Training plans as sharp as **race day.**" — `clamp(38px, 4.5vw, 62px)`, weight 900, `#fc4c02` on "race day."
- Body: 17px, `#94a3b8`, max 46ch
- CTAs: "Start for free →" (orange, glowing shadow) + "Sign in" (ghost)
- Social proof line: "Works with any PDF training plan · Align to your race in minutes" — muted, 13px

**Right app mockup:**
- Dark card (`#0f1729`) showing week view: 7-day grid with colour-coded day states
  - Done: green tint + tick
  - Active/today: orange tint
  - Rest: 35% opacity
- Plan header bar: plan name + "Race: Oct 19 · 38 days" badge
- Progress bar: orange gradient, percentage complete
- Strava sync row at bottom

> **Note:** The real app's calendar/week view should be updated to match this mockup's styling (dark card, colour-coded states, progress bar). This is a follow-up UI task.

**Background:** radial orange glow left, subtle blue glow right, on `#070c16` base

### 3. Testimonial Strip
- Immediately below hero, above the fold on desktop
- 3 quotes in a horizontal row, divided by thin lines
- Dark background, slightly elevated from body
- Mobile: stacks vertically, one quote per row
- Placeholder content:
  - "Had my full race calendar set up in under 3 minutes." — James T., Ironman
  - "Finally a tool that gets how runners think about build weeks." — Sarah M., Marathon BQ 2024
  - "My athletes love the shared plan and completion tracking." — Coach Priya N.

### 4. How It Works
- Section eyebrow: "How it works"
- Headline: "From PDF to race-ready in three steps."
- 3 numbered steps connected by a vertical orange line (CSS `::before` pseudo-element)
- Step 1 (Upload PDF): fully lit — orange circle, active state
- Step 2 (Set race date): mid — outlined orange circle
- Step 3 (Execute daily): dim — outlined muted circle
- Each step has: label, title, description, inline detail tag with key stat
- Mobile: same layout, slightly smaller type

### 5. Features
- 3 cards in a 3-column grid (1-column on mobile)
- Dark card: `#0f1729`, border glows orange on hover
- Each card: emoji icon in tinted rounded square + title + description
- Upload & Parse (orange icon) / Race-Day Alignment (blue icon) / Coach Sync (green icon)

### 6. Bottom CTA
- Full-width dark card with orange radial glow above, blue glow below
- Headline: "Your next race is already **waiting.**"
- Body: "Import your plan, set your race date, and make every workout in the build count."
- CTAs: "Create free account →" (orange) + "Sign in" (ghost)
- Footnote: "Free to start · No credit card required"
- Stats strip inside card: "2 min / PDF to plan", "Auto / Race-week alignment", "Daily / Execution tracking"

### 7. Footer
- Logo + wordmark + tagline left
- 3 link columns right: Product / Account / Legal
- Bottom row: copyright left, Privacy + Terms right
- All muted — doesn't compete with CTA above

---

## CSS Architecture

Files to create/modify:
- `src/app/page.module.css` — full replacement
- `src/app/page.tsx` — full replacement

Tokens used:
- `--d-orange`: `#fc4c02`
- `--d-green`: `#0f8a47`
- Body background: `#070c16`
- Card background: `#0f1729`
- Nav/section background: `#111f38`
- Text primary: `#f5f8ff`
- Text muted: `#94a3b8`
- Text dim: `#475569`
- Border: `rgba(255,255,255,0.07)`
- Border accent: `rgba(252,76,2,0.25)`

Typography: Figtree (existing global font)
Headline sizes: `clamp()` for fluid scaling

---

## Responsive Breakpoints

| Breakpoint | Changes |
|---|---|
| `≥768px` | Split hero (2-col), testimonials horizontal, features 3-col |
| `<768px` | Stacked hero (copy → mockup), testimonials vertical, features 1-col |
| `≤480px` | Reduced padding, CTA buttons full-width, social proof pills wrap |

---

## Follow-up Tasks (out of scope for this implementation)

1. **Real app week view reskin** — update `/plans/[id]` and `/calendar` day/week views to match the dark card week mockup style shown in the hero
2. **Real testimonials** — replace placeholder quotes with actual user feedback
3. **Stats counter** — replace static numbers with real DB counts once user base grows
4. **Pricing page** — add a `/pricing` route linked from nav and footer

---

## Implementation Notes

- Page is a Next.js server component (`async function Home()`) — keep as-is, no client state needed
- Clerk `currentUser()` redirect stays unchanged
- All images: replace hero runner photo with a high-quality athlete photo (dark/moody tone). Feature card SVGs can stay or be replaced with inline CSS mockups.
- No JS animations in v1 — CSS transitions only to keep the page fast
- Ensure `prefers-reduced-motion` is respected for any transitions
