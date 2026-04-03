# Parser Prompt Patch & Coaching Guidance Extraction — Design Spec

**Date:** 2026-04-03
**Status:** Approved

---

## Context

A local LLM analysis pipeline (`scripts/derive-parser-rules.mjs`, `/admin/parser-rules`) was built to batch-analyse training plan PDFs and surface patterns the V4 parser misses. Findings are stored in `scripts/parser-analysis/aggregate.json`.

Two problems remain unsolved:

1. **Applying findings to the parser prompt** — the current "Apply to Prompt" UI just appends findings to the bottom of the active prompt. This is unreliable; rules need to land in the right section of the right prompt.

2. **Coaching guidance not captured** — the vision extraction stage extracts Trainer Notes and per-session coaching cues from PDFs, but they are silently discarded. Athletes never see the "how" of their workouts, only the "what".

This spec covers both as two independent but sequentially planned workstreams.

---

## Workstream 1 — Prompt Patch Workflow

### Goal

Replace the dumb-append apply flow with an LLM-assisted diff/review UI where the local LLM suggests section-anchored insertions, the admin reviews and approves/rejects each, and approved changes are saved as a new named prompt version.

### Architecture

**Data flow:**
```
aggregate.json (findings)
  + active prompt text(s) from DB
  → POST /api/admin/parser-rules/patch
      → local LLM: given findings + prompt, return section-anchored insertions
      → returns PatchSuggestion[]
  → UI renders diff per section
  → admin approves/rejects individual suggestions
  → POST /api/admin/parser-prompts (save new version per affected prompt)
```

**`PatchSuggestion` shape:**
```ts
{
  prompt_target: 'vision' | 'md_parser',
  after_section: string,   // e.g. "ABBREVIATIONS", "RULES"
  insert_text: string,     // exact text to insert
  rationale: string,       // why this belongs here
  source_issue: string,    // the finding it addresses
  approved: boolean        // toggled by admin in UI
}
```

### Prompt DB Migration

`VISION_EXTRACTION_PROMPT` (currently hardcoded in `src/lib/prompts/plan-parser/vision-extraction-prompt.ts`) moves into a DB `ParserPrompt` record (seeded via a migration script or admin action). The `.ts` file is retained as a fallback constant only — used when no DB record named `vision_master` exists.

Both prompts (`vision_master`, `md_parser_master`) become DB-managed and versionable identically.

### New API Route

`POST /api/admin/parser-rules/patch`

- Accepts: `{ server, model, prompt_targets: ['vision'|'md_parser'|'both'] }`
- Fetches active prompt(s) from DB
- Reads `aggregate.json`
- Calls local LLM with a structured prompt: "given these findings and this prompt text, return a JSON array of section-anchored insertions"
- Returns `PatchSuggestion[]`
- Does NOT write anything — read-only until admin approves

### Admin UI Changes

Replace the "Apply to Prompt" panel in `ParserRulesClient.tsx` with a **"Review Patch"** panel:

- One card per `PatchSuggestion`:
  - Header: `[vision | md_parser] → after: "SECTION NAME"`
  - Body: diff view — existing section heading, then `+ inserted text` highlighted green
  - Footer: rationale text + source issue label
  - Approve/reject toggle (default: approved)
- "Save approved changes" button:
  - Groups approved suggestions by `prompt_target`
  - For each affected prompt: appends insertions at the correct section position
  - Saves as new named version (`{existing_name}_patched_{date}`)
  - Optionally activates immediately (checkbox)

### Files to Change

| File | Change |
|------|--------|
| `src/app/api/admin/parser-rules/patch/route.ts` | New route |
| `src/app/admin/parser-rules/ParserRulesClient.tsx` | Replace apply panel with review-patch panel |
| `src/lib/prompts/plan-parser/vision-extraction-prompt.ts` | Retain as fallback constant only |
| `scripts/seed-vision-prompt.mjs` (new) | One-shot script to seed vision prompt into DB |

---

## Workstream 2 — Coaching Guidance Pipeline

### Goal

Extract coaching guidance (the "how" of workouts, weekly context, pacing philosophy) from PDFs and surface it to athletes: inline on activity cards and as a collapsible week brief.

### Data Flow

```
PDF
 └─ Vision LLM (updated prompt)
     ├─ Trainer Notes → week_brief per week (prefixed "Week N:")
     ├─ Per-session coaching cues → Notes column (verbatim)
     └─ Weekly tables (unchanged)
 └─ MD Parser (updated prompt)
     ├─ session.coaching_note  — how to execute this session (prose)
     ├─ session.session_focus  — typed focus label
     └─ week.week_brief        — weekly context (from Trainer Notes)
 └─ DB
     ├─ PlanActivity.coachingNote  String?
     ├─ PlanActivity.sessionFocus  String?
     └─ PlanWeek.coachBrief        String?
 └─ Athlete UI
     ├─ Activity card: coach note line below steps
     └─ Day/week header: collapsible "Coach's note" row
```

### Schema Changes

**`src/lib/schemas/program-json-v1.ts`:**

Add to `SessionV1Schema`:
```ts
coaching_note: z.string().nullable().optional()
session_focus: z.enum(['tempo','threshold','recovery','long_run','race_sim','strength','other']).nullable().optional()
```

Add to `WeekV1Schema`:
```ts
week_brief: z.string().nullable().optional()
```

**`prisma/schema.prisma`:**

```prisma
model PlanActivity {
  // ... existing fields ...
  coachingNote  String?
  sessionFocus  String?
}

model PlanWeek {
  // ... existing fields ...
  coachBrief    String?
}
```

### Prompt Changes

**Vision extraction prompt** (`vision-extraction-prompt.ts` / DB):

1. Weekly table rule addition: *"Preserve any per-session coaching cues (how to run it, perceived effort, technique focus) verbatim in the Notes column — separate from any metric data."*
2. Trainer Notes instruction addition: *"Prefix each week-specific note with `Week N:` (e.g. `Week 3: This is a build week — expect fatigue mid-week`) so the parser can map it to the correct week."*

**MD parser prompt** (`md-parser-prompt.ts` / DB):

1. Add extraction rule: *"Extract `coaching_note` from the Notes column — the qualitative 'how to run it' guidance, not the metric. Null if no coaching cue present."*
2. Add extraction rule: *"Set `session_focus` to one of: tempo, threshold, recovery, long_run, race_sim, strength, other — infer from session content."*
3. Add extraction rule: *"Extract `week_brief` from the Trainer Notes section for this week number. Null if no matching note."*

### Mapping Layer

**`src/lib/parsing/v4-to-plan.ts`** — add to the `PlanActivity` create payload:
```ts
coachingNote: session.coaching_note ?? null,
sessionFocus: session.session_focus ?? null,
```

And to the `PlanWeek` create payload (same file — weeks are mapped here too):
```ts
coachBrief: week.week_brief ?? null,
```

### Athlete UI

**Activity card** (wherever `PlanActivity` is rendered in the daily/calendar view):
- Below the steps list: small italic line showing `coachingNote`
- Truncated at 2 lines with inline "more" expand
- Hidden entirely when `coachingNote` is null
- Style: muted text (`--d-muted`), 13px, no icon

**Week/day header**:
- Disclosure row: "Coach's note ›" — tap expands to show `coachBrief` inline
- Hidden entirely when `coachBrief` is null
- Style: consistent with existing card secondary text

**Backward compatibility:** All new fields are nullable. Existing plans render identically — no coaching note shown, no coach brief shown.

### Files to Change

| File | Change |
|------|--------|
| `src/lib/schemas/program-json-v1.ts` | Add `coaching_note`, `session_focus`, `week_brief` |
| `prisma/schema.prisma` | Add `coachingNote`, `sessionFocus` to PlanActivity; `coachBrief` to PlanWeek |
| `src/lib/prompts/plan-parser/vision-extraction-prompt.ts` | Update coaching cue instructions |
| `src/lib/prompts/plan-parser/md-parser-prompt.ts` | Add coaching extraction rules |
| `src/lib/parsing/v4-to-plan.ts` | Map new session fields |
| `src/lib/parsing/v4-to-plan.ts` | Map `week_brief` on PlanWeek create |
| `src/components/DayLogCard.tsx` | Render `coachingNote` below steps |
| `src/app/dashboard/page.tsx`, `src/app/calendar/page.tsx` | Render `coachBrief` disclosure row on week/day header |

---

## Sequencing

Workstream 1 first — the prompt patch workflow improves the prompts that Workstream 2 depends on. Once prompts are patched and validated against real PDFs, Workstream 2 extraction quality will be higher.

1. WS1: DB-migrate vision prompt → build patch API → build review UI
2. WS2: Extend schema → update prompts (using WS1 workflow) → DB migration → map fields → athlete UI

---

## Out of Scope

- Garmin integration
- Coach-authored notes (manual entry by a coach) — extraction only for v1
- Filtering/search by `session_focus` — stored but not surfaced in UI beyond display
- AI-generated coaching notes — extraction from existing plan text only
