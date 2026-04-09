---
status: resolved
trigger: "Monday session 'Strength 1 (Circuit 1 — weeks 1–8; see Strength & Conditioning section) + Easy run' should parse as 2 separate activities but is only producing 1 activity"
created: 2026-04-08T00:00:00Z
updated: 2026-04-08T00:02:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: FIXED — splitCompoundSessionText added to markdown-program-parser.ts splits ' + ' outside parentheses only when parts have heterogeneous activity types. Data fix script ran against plan cmnq97nze0008kjekag54rppi and confirmed 2 activities per Monday (STRENGTH + RUN) for all weeks 1-8.
test: Navigate to /plans/cmnq97nze0008kjekag54rppi/review and verify Monday weeks 1-8 show 2 separate activities
expecting: User confirms Monday shows Strength + Easy run as 2 activities
next_action: Await human verification

## Symptoms

expected: |
  Monday day in weeks 1-8 has the text:
    "Strength 1 (Circuit 1 — weeks 1–8; see Strength & Conditioning section) + Easy run"
  This should produce 2 PlanActivity records:
    1. Type: Strength, name: "Circuit 1" (or similar), detail pulled from plan guide
    2. Type: Easy run (or Run with Easy effort)
actual: Only 1 activity is produced. The '+' separator is not being used to split into 2 activities.
errors: None — purely a parsing/translation issue
timeline: Unknown when it started; user has not confirmed it ever worked
reproduction: |
  Plan ID: cmnq97nze0008kjekag54rppi
  Navigate to /plans/cmnq97nze0008kjekag54rppi/review
  Look at any Monday in weeks 1–8; activity shows as a single merged item

## Eliminated

- hypothesis: The issue is in v4-to-plan.ts grouping sessions by day
  evidence: v4-to-plan.ts correctly handles multiple sessions per day via byDay map; the problem is upstream — only 1 session is produced per row
  timestamp: 2026-04-08T00:01:00Z

## Evidence

- timestamp: 2026-04-08T00:01:00Z
  checked: DB PlanActivity records for weeks 1-4 Monday
  found: Only 1 activity per Monday with type=STRENGTH, rawText="Strength 1 (Circuit 1 — weeks 1–8; see Strength & Conditioning section) + Easy run"
  implication: The full compound string is stored as one activity — splitting never happened

- timestamp: 2026-04-08T00:01:00Z
  checked: markdown-program-parser.ts parseSessionRow function
  found: Produces one SessionV1 per markdown table row. inferActivityType checks "strength" first and returns "Strength". No '+' splitting logic exists.
  implication: ROOT CAUSE — the parser needs to split compound sessions on ' + ' (outside parentheses)

- timestamp: 2026-04-08T00:01:00Z
  checked: V4 AI parser output (V4_OUTPUT artifact)
  found: Also produces only 1 session for Monday (type: Strength). Both parsers fail to split.
  implication: Fix must go into markdown-program-parser.ts since persistence_source=markdown-primary

- timestamp: 2026-04-08T00:01:00Z
  checked: Extracted markdown for Week 1 Monday
  found: "Strength 1 (Circuit 1 — weeks 1–8; see Strength & Conditioning section) + Easy run" — '+' is outside parentheses and is a true compound separator
  implication: A regex that splits on ' + ' while respecting parentheses depth will correctly split this

## Resolution

root_cause: |
  parseSessionRow in markdown-program-parser.ts produced exactly one SessionV1 per markdown table row.
  A row like "Strength 1 (...) + Easy run" was treated as a single session; inferActivityType matched
  "strength" first and returned Strength, discarding the "Easy run" component entirely.
  No ' + ' compound-session splitting existed anywhere in the markdown parser pipeline.

fix: |
  Added splitCompoundSessionText() to markdown-program-parser.ts. It walks the session text char-by-char,
  tracking parenthesis depth, and splits on ' + ' tokens at depth 0 only. After finding candidate parts,
  it checks whether they resolve to heterogeneous activity types — if all parts are the same type (e.g.
  "WU 1 mile + Tempo 3 miles + CD 1 mile" = all Run), it keeps the text as one session. Only when parts
  have different types (Strength + Run, CrossTraining + Strength) does it split into multiple SessionV1s.
  parseWeekTables updated from .map() to .flatMap() to handle multi-session rows.
  Data fix script (scripts/fix-monday-compound-sessions.ts) re-parsed the EXTRACTED_MD artifact and
  rebuilt all 16 weeks for plan cmnq97nze0008kjekag54rppi.

verification: |
  DB confirmed: weeks 1-8 Monday now has 2 activities [STRENGTH, RUN] each.
  Week 1 Wednesday now has 2 activities [OTHER (Incline Treadmill), STRENGTH (Circuit 2)].
  Session-flow pre-check added: texts containing WU/CD/interval notation ("x N sec/min")
  or pipe "|" separators return immediately as a single session without splitting.
  4/4 parser tests pass including 2 new regression tests for Hills session-flow case.
  Typecheck clean.

files_changed:
  - src/lib/parsing/markdown-program-parser.ts
  - scripts/fix-monday-compound-sessions.ts
  - scripts/markdown-program-parser.test.ts
