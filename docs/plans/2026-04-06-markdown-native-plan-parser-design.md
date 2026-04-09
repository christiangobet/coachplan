# Markdown-Native Plan Parser Design

## Summary

The current markdown-first upload pipeline succeeds at the hardest part, `PDF -> EXTRACTED_MD`, and then loses reliability by asking a second large-model pass to regenerate the full plan as `ProgramJsonV1`. That second pass is now the bottleneck in both latency and correctness.

The replacement should treat `EXTRACTED_MD` as the canonical source of truth for plan structure. Weeks, days, session rows, mileage, durations, notes, glossary entries, and trainer notes should be parsed deterministically from markdown. A much smaller AI pass should remain available only for rich semantic interpretation on already-isolated session rows.

## Goals

- Make `EXTRACTED_MD` the primary parse artifact for program structure.
- Remove the large chunked `EXTRACTED_MD -> ProgramJsonV1` AI reconstruction step.
- Preserve richer semantic output, including:
  - `session_role`
  - `steps`
  - intensity metadata
  - key-session and bail markers
  - weekly coaching context where available
- Keep the existing completeness enforcement so partial plans are not persisted.
- Reuse the current `ProgramJsonV1 -> DB` persistence path where possible.

## Non-Goals

- Replace PDF extraction in this pass.
- Rebuild the review UI.
- Eliminate AI entirely from the parsing pipeline.
- Redesign the `ProgramJsonV1` schema.
- Rewrite persistence from scratch if the existing `populatePlanFromV4(...)` path can still be used.

## Current Problem

Today the pipeline is:

`PDF -> EXTRACTED_MD -> chunked LLM parse -> ProgramJsonV1 -> DB`

That middle step is expensive and fragile because it:

- reparses already-structured weekly markdown tables
- depends on chunk scheduling and retry budgets
- can fail or time out even when `EXTRACTED_MD` is already correct
- can produce partial plans if chunk coverage is incomplete

The extracted markdown already contains the information we need in a much more directly usable form than the raw PDF:

- `## Week N` sections
- weekly markdown tables
- `TWM` summaries
- glossary sections
- trainer notes
- workout footnotes and guidance

## Proposed Architecture

### Stage 1: Deterministic markdown document parse

Add a markdown-native parser that reads `EXTRACTED_MD` directly and builds a complete structural program skeleton:

- document sections
- week numbers
- per-week markdown tables
- day rows
- raw session strings
- distance and duration fields
- weekly mileage summaries
- glossary and trainer-note context

This stage should be fully deterministic and should not use AI.

### Stage 2: Deterministic semantic baseline

From each parsed row, derive as much semantics as possible with rules:

- map day names to `Mon..Sun`
- detect `Run`, `Rest`, `CrossTraining`, `Strength`, `Race`, `Mobility`, `Yoga`, `Hike`, `Other`
- detect obvious session families:
  - easy
  - long run
  - tempo
  - intervals
  - hills
  - race pace
  - recovery
- extract distance and duration ranges
- treat `TWM` as week summary metadata
- mark key sessions from stars and must-do language
- mark bail-allowed sessions from heart symbols and bail guidance

This stage should create a valid first-pass `ProgramJsonV1` without waiting on any AI call.

### Stage 3: Narrow AI enrichment

After the deterministic parse, run a small AI enrichment pass only on individual session records that still need semantic help.

This pass should operate on tiny inputs:

- one session row
- optional week summary context
- optional glossary/trainer-note snippets relevant to abbreviations

It should fill or refine:

- `session_role`
- `steps`
- `target_intensity`
- `coaching_note`
- `session_focus`
- WU/CD structure when the session text is compressed

It should not be responsible for:

- discovering week boundaries
- discovering day rows
- reconstructing whole weeks
- deciding whether the plan is complete

### Stage 4: Validation and persistence

The enriched result should still flow through the existing completeness checks and persistence rules:

- contiguous weeks required
- no markdown-primary persistence for partial plans
- same `ProgramJsonV1 -> populatePlanFromV4(...)` contract where practical

## Module Shape

### New modules

- `src/lib/parsing/markdown-program-parser.ts`
  - reads `EXTRACTED_MD`
  - builds deterministic `ProgramJsonV1` skeleton
- `src/lib/parsing/markdown-session-enricher.ts`
  - enriches selected session rows with a small AI pass

### Existing modules to adapt

- `src/lib/ai-plan-parser.ts`
  - replace the large chunked markdown parse with the deterministic parser + session enrichment path
- `src/lib/parsing/v4-to-plan.ts`
  - keep as the persistence target, with current completeness guardrails
- `src/lib/parsing/program-week-completeness.ts`
  - continue to act as the final structural gate

## Data Flow

The new pipeline should be:

`PDF -> EXTRACTED_MD -> markdown-program-parser -> optional session enricher -> ProgramJsonV1 -> completeness check -> DB`

This changes the role of AI from "primary parser" to "local semantic interpreter."

## Why This Is Better

- Structural parsing becomes fast and deterministic.
- The system stops paying a large latency tax for giant markdown chunk prompts.
- Failures become local to specific session enrichments instead of catastrophic to the entire plan.
- The upload pipeline can still show `EXTRACTED_MD` immediately while continuing with smaller enrichment work.
- Existing review and persistence surfaces can continue to operate on `ProgramJsonV1`.

## Risks

### 1. Markdown table variability

Some plans may vary in table shape or formatting. The parser should therefore support:

- standard weekly row tables
- minor spacing and punctuation differences
- blank cells
- rows with rich note text in the session column

### 2. Semantic richness regression

A purely deterministic parser could miss nuanced structure in workouts like:

- nested intervals
- WU/CD breakdowns
- intensity interpretation from abbreviations

That is why the AI enrichment pass remains in scope, but only at the session level.

### 3. Mixed deterministic and AI outputs

The contract between deterministic parse and enrichment must stay explicit:

- deterministic fields should not be overwritten casually
- AI should refine ambiguous fields, not reclassify whole weeks

## Testing Strategy

- Fixture-driven tests using saved `EXTRACTED_MD` examples.
- Deterministic parser regression tests for week/day/table extraction.
- Enrichment tests for ambiguous session rows.
- End-to-end regression ensuring a valid `EXTRACTED_MD` can produce a complete `ProgramJsonV1` without chunked full-plan markdown parsing.
- Existing completeness tests must continue to block partial week persistence.

## Success Criteria

- A plan with valid weekly markdown tables can produce a complete `ProgramJsonV1` without the chunked markdown LLM parser.
- The parser no longer depends on per-batch budget allocation to discover all weeks.
- Rich semantic fields remain available through narrow AI enrichment.
- Uploads that already have a strong `EXTRACTED_MD` complete significantly more reliably than the current chunked markdown parse path.
