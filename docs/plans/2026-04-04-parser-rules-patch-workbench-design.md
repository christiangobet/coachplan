# Parser Rules Patch Workbench Design

## Summary

The current `Suggest Patches` flow is too lossy and too opaque. It asks the LLM for final prompt insertions from `aggregate.json`, which compresses the saved per-PDF analyses into a small generic summary before patch generation even starts. That means the system throws away high-value evidence such as exact problematic snippets, PDF-specific anomalies, and file-by-file support before it drafts prompt changes.

The replacement should treat `scripts/parser-analysis/` as a corpus and build an iterative patch workbench on top of it. Instead of one blocking LLM call, the new flow should index the saved analyses, cluster issue families, draft candidate prompt edits, critique them, run a lightweight evaluation pass, and only then present a final adjustment bundle for review and save.

## Goals

- Fully exploit the per-PDF analysis files already saved in `scripts/parser-analysis/`.
- Replace the one-shot patch suggestion call with an evidence-backed iterative pipeline.
- Preserve intermediate artifacts so the process is reviewable and resumable.
- Give the admin UI live progress updates instead of a silent blocking request.
- Show why each proposed prompt adjustment survived, including evidence and eval summaries.
- Filter out duplicate, overfit, and weak prompt edits before the user sees them.

## Non-Goals

- Build a full parser benchmark harness in this pass.
- Re-run raw PDF extraction during patch generation.
- Automatically apply prompt edits without human approval.
- Change the existing per-PDF analysis schema as part of this redesign.
- Replace the existing `Run Analysis` pipeline beyond what is needed to consume its outputs.

## Current Problems

### 1. Evidence is compressed too early

The current patch route loads only `aggregate.json` and ignores the individual `*.json` plan files. This flattens diverse plan-specific issues into a handful of generic issue labels and weakens the eventual patch suggestions.

### 2. Too many responsibilities in one LLM call

The current flow asks a single model call to:

- interpret the findings
- identify the important issue families
- decide what belongs in the prompt
- select anchors
- draft insertion text

This creates weak traceability and makes it hard to understand why a patch was suggested.

### 3. No critique or validation loop

The system does not currently ask:

- is this already covered by the active prompt?
- is this rule overfit to one PDF?
- does this anchor make semantic sense?
- does this patch generalize across the corpus?

### 4. The UX feels stalled

The client performs a single blocking fetch for patch suggestions. Because there is no streaming progress, the button can look hung even when the server is still working.

## Proposed Architecture

The replacement flow is a patch workbench that operates as a staged pipeline.

### Stage 1: Evidence Ledger

Build a normalized ledger from every analysis file in `scripts/parser-analysis/`, excluding `aggregate.json`.

The ledger should include:

- `plans`: one entry per PDF with layout, source units, detected weeks, anomalies, and summary metadata
- `evidence`: flattened issue entries derived from:
  - `unhandled_patterns`
  - `prompt_improvements`
  - `new_abbreviations`
  - notable `sessions_sample` items with parsing notes
- `stats`: counts by issue category, file, layout type, and source units

Every evidence row should get a stable `evidence_id` so later stages can cite it directly.

### Stage 2: Issue Clustering

Run an LLM clustering pass over the normalized ledger. The output should group evidence into issue families that the prompt could realistically address.

Each cluster should include:

- `id`
- `title`
- `description`
- `supporting_files`
- `evidence_ids`
- `frequency`
- `representative_examples`
- `candidate_rule_direction`

This stage should preserve traceability from each cluster back to exact evidence rows and source PDFs.

### Stage 3: Patch Drafting

Generate candidate prompt edits one issue family at a time, not as a single undifferentiated patch list.

Each patch candidate should include:

- `cluster_id`
- `after_section`
- `insert_text`
- `rationale`
- `evidence_ids`
- `specificity`
- `expected_benefit`

The drafting stage should focus on creating good candidate text, not deciding final acceptance.

### Stage 4: Critique and Merge

Run a second pass that reviews the drafted candidates against the active prompt and the rest of the candidate set.

This stage should:

- reject duplicates of existing rules
- reject overly PDF-specific rules
- reject weak or missing anchors
- merge overlapping candidates
- explain why each rejected or merged idea did not survive

The output should separate `accepted`, `rejected`, and `merged` candidates.

### Stage 5: Lightweight Evaluation

Run a final scoring pass on the accepted candidates using a representative eval subset of the saved analyses.

The eval stage should answer:

- does the candidate patch address the cited evidence?
- does it likely generalize beyond the source PDFs?
- does it overlap with existing prompt coverage?
- could it create false positives or over-parsing?
- what is the confidence level?

This is not a full parser execution benchmark. It is a structured evidence-based review of likely prompt impact.

### Stage 6: Final Adjustment Bundle

Produce a final review bundle that the UI can show and the user can approve for save/activation.

This bundle should contain only the final user-approvable adjustments plus evidence and evaluation summaries.

## Artifacts

All workbench outputs should live under `scripts/parser-analysis/patch-workbench/`.

- `evidence-ledger.json`
- `issue-clusters.json`
- `patch-candidates.json`
- `patch-review.json`
- `patch-eval.json`
- `final-adjustment-bundle.json`

These artifacts make the workflow auditable, resumable, and debuggable.

## API Design

### `POST /api/admin/parser-rules/patch-workbench`

This route should stream NDJSON progress events through the same style of single-close stream helper already used on the analysis route.

Event types should include:

- `stage_start`
- `stage_progress`
- `stage_complete`
- `candidate_preview`
- `eval_result`
- `complete`
- `error`

The route should:

1. verify admin access
2. load the active prompt
3. build the evidence ledger from saved analyses
4. run cluster, draft, critique, and eval stages
5. persist artifacts
6. stream progress and final bundle back to the client

### `GET /api/admin/parser-rules/patch-workbench`

This route should return the latest saved bundle and optional artifact summaries so the UI can recover after refresh without re-running the whole pipeline.

### Compatibility

The existing `/api/admin/parser-rules/patch` route should either:

- become a compatibility wrapper around the new workbench, or
- stay temporarily for legacy usage while the UI migrates

The preferred direction is to migrate the UI and then retire the legacy one-shot patch route.

## UI Design

The current button should be repositioned from a vague `Suggest Patches` action to a more explicit workbench action such as `Generate Prompt Adjustments`.

### Progress UX

The UI should show live stage progress:

- building evidence ledger
- clustering issues
- drafting candidate rules
- critiquing candidates
- evaluating finalists

This removes the current “is it stuck?” feeling.

### Review UX

The results area should show:

- final adjustments
- rejected or merged ideas
- evidence and evaluation details

Each final adjustment should display:

- the exact insertion text
- anchor
- supporting files
- representative examples
- confidence
- generalization risk
- why the patch was kept

## Deterministic Guardrails

Before or during critique/eval, the system should deterministically reject or down-rank candidates that:

- have only one weak supporting file
- duplicate existing active-prompt rules
- use fragile anchors
- are branded or plan-specific instead of describing a general parsing pattern

These guardrails should run outside the LLM where possible so the workbench is more stable and explainable.

## Files Expected To Change

- `src/app/api/admin/parser-rules/patch/route.ts`
- `src/app/admin/parser-rules/ParserRulesClient.tsx`
- `src/lib/openai.ts` or a dedicated parser-rules LLM helper if extraction is shared
- `src/lib/ndjson-stream.ts`
- new workbench helper modules under `src/lib/parser-rules/`
- new tests under `scripts/`

## Validation

- The workbench reads all saved per-PDF analysis files, not just `aggregate.json`.
- The patch flow streams visible progress to the UI.
- Intermediate artifacts are saved under `scripts/parser-analysis/patch-workbench/`.
- Final adjustments include evidence citations and eval summaries.
- Duplicate, weak, or overfit patch candidates are filtered before review.
- The final bundle survives page refresh through a `GET` endpoint.
