# PDF → MD → Parse: Vision Extraction Layer Design

**Date:** 2026-03-26
**Status:** Approved
**Driver:** Parse quality — training plan PDFs contain richer activity descriptions (session structure, strength circuits, coaching notes, abbreviation glossaries) than the current pdfjs text extraction captures.

---

## Problem Statement

The current pipeline extracts raw text from PDFs using `pdfjs-dist`, which:
- Loses table structure (week/day grid cells merge into a stream)
- Discards spatial relationships between cells and their glossary definitions
- Misses supplementary sections (strength routines, trainer notes, race strategy)
- Forces the AI parser to reconstruct structure from flattened text, driving prompt complexity and chunking hacks

The result: abbreviated codes like "T2" reach V4 without the legend that defines them, strength sessions get a label but no exercise detail, and coaching context is silently dropped.

---

## Solution: Two-Call Pipeline with Enriched MD Intermediate

```
PDF ──▶ pdf-to-md.ts (vision LLM) ──▶ plan.md (stored artifact)
plan.md ──▶ md-chunker.ts + V4 (simplified) ──▶ ProgramJsonV1
ProgramJsonV1 ──▶ v4-to-plan.ts ──▶ DB   ← unchanged
```

---

## Stage 1: Vision Extraction (`pdf-to-md.ts`)

### Vision LLM Choice

Two options — pick one before implementation:

| Option | How PDF is passed | Rendering dep | Notes |
|--------|------------------|---------------|-------|
| **Claude claude-sonnet-4-5** (recommended) | PDF bytes as document input (native API support) | None — no `canvas` needed | Eliminates page rendering entirely; simpler on Vercel serverless |
| **GPT-4o** | Pages rendered to PNG, passed as base64 image blocks | `canvas` (native binary, problematic on Vercel) | Reuses existing OpenAI integration |

The Claude option is recommended: it accepts the raw PDF buffer directly via the Anthropic messages API (`document` content block), removing the rendering step and the Vercel binary dependency risk.

### PDF → LLM Input

**Claude path:** pass PDF buffer as `{ type: "document", source: { type: "base64", media_type: "application/pdf", data: <base64> } }` in the messages API. No page rendering needed.

**GPT-4o path (fallback):** use `pdfjs-dist` + `canvas` to render each page to PNG, pass as base64 image content blocks.

### Vision LLM Call Strategy

| Plan size | Strategy |
|-----------|----------|
| ≤ 8 pages | Single call — full PDF + extraction prompt |
| > 8 pages | Two-pass: Pass 1 = full PDF + survey prompt (glossary + week index + layout type); Pass 2 = 5-week page ranges with glossary as context, results merged |

Threshold configurable via `VISION_EXTRACT_PAGE_THRESHOLD` env var (default: 8).

### Extraction Prompt Output Format

The vision LLM produces a canonical MD document:

```markdown
## Glossary
| Code | Full description |
| T2   | 2×10min tempo @ 7:30/mile, 5min jog recovery |
| LR   | Long run at conversational pace (Zone 2) |

## Strength & Conditioning
Full exercise descriptions with sets/reps and coaching cues, extracted
verbatim from wherever they appear in the PDF.

A1. Single-leg squat — 3×8 each side. Keep knee tracking over toe...

## Trainer Notes
Any narrative content from the coach outside the schedule: pacing strategy,
phase goals, taper guidance, race week advice.

## Week 1
| Day | Session | Distance | Notes |
| Mon | Easy run | 8km | Zone 2, conversational |
| Tue | WU 15min easy + 3×8min @ tempo (T2: 2×10min @ 7:30/mile) + CD 10min | 14km | Key session |
| Wed | Rest | — | — |
| Thu | Strength A (see Strength & Conditioning) | — | 3 rounds |

## Week 2
...
```

### Extraction Prompt Instructions

- Extract the glossary/legend from wherever it appears in the PDF (sidebar, footer, last page, inline key)
- Extract all supplementary sections: strength routines, mobility circuits, cross-training descriptions, drill libraries — preserve exercise names, sets/reps, and coaching cues verbatim
- Preserve trainer narrative: coach commentary, race strategy, phase goals, pacing tips in text blocks outside the schedule table
- Resolve abbreviations inline in the schedule cells using the glossary
- Expand session structure inline: WU / intervals / CD breakdown inside the cell
- Cross-reference supplementary sections: when schedule says "Strength A", include a brief inline summary in the cell
- Handle multilingual content natively (German, French, English) — translate to English in output
- Output one `## Week N` section per week — these are the chunk boundaries for the parser

### Output Artifact

The completed `plan.md` is stored as a `ParseArtifact` with `type = "EXTRACTED_MD"` on the `ParseJob`. Every parse is replayable: re-run V4 on the stored MD without re-processing the PDF.

---

## Stage 2: Simplified Parser

### What V4 No Longer Needs to Do

Removed from V4 prompt:
- Table reconstruction from raw text
- Abbreviation expansion rules
- Localized term handling (German/French)
- Glossary detection instructions
- Cell boundary inference
- Layout type detection

Kept in V4 prompt:
- Map weeks/days to `ProgramJsonV1` schema
- Activity type classification
- Distance / duration / pace extraction
- Session step structure (WU/quality/CD)
- Priority inference (key/optional/must-do)
- Quality checks output

### `md-chunker.ts` — Semantic Chunking

Replaces byte-count splitting in `v4-pass-strategy.ts`:

- Split `plan.md` at `## Week N` headers
- Prepend `## Glossary` + `## Strength & Conditioning` + `## Trainer Notes` to every chunk — parser always has full supplementary context
- Default chunk size: 5 weeks (same as current, but now semantically bounded)

### Simplified Pass Strategy

| Condition | Action |
|-----------|--------|
| All weeks fit in context (≤ 20 weeks typical) | Single V4 call |
| > 20 weeks | 5-week chunk passes → merge |
| Missing week after merge | Targeted single-week retry (unchanged) |

`v4-pass-strategy.ts` is slimmed — byte-count logic removed, week-header splitting replaces it.

### V5 Survey Call — Retired

The V5 survey call (detects layout type and glossary from raw text) is retired. The extraction MD already contains that information. The `planGuide` passed to V4 becomes the `## Trainer Notes` section from the MD.

---

## Integration & Rollout

### Feature Flag

```
PARSER_VISION_EXTRACT=false  → current path (pdfjs + V4/V5) — untouched
PARSER_VISION_EXTRACT=true   → new path (pdf-to-md → V4 simplified)
```

Flag lives in the existing `FLAGS` object alongside `PARSER_V4` / `PARSER_V5`. Both paths produce identical `ProgramJsonV1` output — `v4-to-plan.ts` does not change.

### Admin Parse-Debug Panel Additions

- New tab: **Extracted MD** — renders the stored `plan.md` artifact for any ParseJob
- Re-parse button: re-run V4 on stored MD without re-uploading the PDF
- Quality diff: compare parse quality score between extraction paths

### Files Retired When Flag Is Stable

- `scripts/parse_plan_pdf.py`
- `src/lib/plan-parser-i18n.mjs`
- `src/lib/parsing/plan-parser-v5.ts`
- `src/lib/parsing/v5-survey-prompt.ts`
- `src/lib/parsing/v5-survey-schema.ts`
- `src/lib/parsing/ai-guide-extractor.ts`

Retired only after the flag is proven stable in production.

### Implementation Sequence

1. Choose vision LLM (Claude recommended — native PDF input, no rendering dep) + build `pdf-to-md.ts`
2. Design and test extraction prompt on 3–4 representative PDFs
3. Add `EXTRACTED_MD` artifact type + admin panel MD viewer
4. Build `md-chunker.ts` (week-header splitting with supplementary prefix)
5. Simplify V4 prompt and pass strategy for MD input
6. Wire up behind `PARSER_VISION_EXTRACT` flag in `ai-plan-parser.ts`
7. A/B quality comparison on existing parse test fixtures
8. Flip flag to default-on, retire old files

---

## What Does Not Change

- `v4-to-plan.ts` — DB ingestion logic
- `program-json-v1.ts` — Zod schemas and types
- `distance-parser.ts` — distance/duration/unit extraction
- `parse-artifacts.ts` — artifact storage helpers
- `/plans/route.ts` — upload orchestration (flag-gated at entry point)
- All DB models (`TrainingPlan`, `PlanWeek`, `PlanDay`, `PlanActivity`)
