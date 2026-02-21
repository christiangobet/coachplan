# CoachPlan — AI Parsing Rules

This file governs how AI agents may modify or extend the training
plan parsing system.

The V4 parsing prompt is a core product component and must be treated
as infrastructure, not implementation detail.

---

## 1. PARSER ARCHITECTURE (AUTHORITATIVE)

CoachPlan parsing pipeline:

PDF
→ Text Extraction
→ V4 Prompt (semantic interpretation)
→ ProgramJSON_v1
→ Normalization Layer
→ Scheduling
→ UI

Each layer has a single responsibility.

AI must preserve this separation.

---

## 2. V4 PROMPT IS AUTHORITATIVE

The file:

src/lib/prompts/plan-parser/v4_master.txt

defines the semantic parsing engine.

AI agents MUST NOT:

- rewrite V4 logic in application code
- partially duplicate interpretation rules
- bypass prompt reasoning using regex hacks
- silently modify prompt behavior

All prompt changes must create a new version:

v5_master.txt
v6_master.txt

V4 must remain reproducible.

---

## 3. OUTPUT SCHEMA IS A STABLE CONTRACT

The JSON structure produced by V4 is a public internal API.

Downstream systems rely on:

- program
- weeks
- sessions
- quality_checks

Rules:

- Never change field meaning without version bump.
- New fields must be backward compatible.
- Structural changes require schema version update.

---

## 4. NO DOCUMENT-SPECIFIC LOGIC

AI must NEVER introduce parsing logic like:

if source == "nike":
    special_case()

Parsing improvements must generalize across documents.

Allowed improvements:

- prompt refinement
- normalization improvements
- better ambiguity handling
- schema enrichment

---

## 5. PARSING FAILURES ARE TRAINING DATA

When parsing fails:

DO NOT patch code immediately.

Instead:

1. store example document
2. analyze failure pattern
3. improve prompt or normalization
4. validate against corpus

Failures improve the parser.

---

## 6. PROMPT HANDLES MEANING — CODE HANDLES STRUCTURE

V4 prompt responsibilities:

- layout interpretation
- coaching semantics
- glossary extraction
- symbolic decoding

Application code responsibilities:

- unit normalization
- scheduling logic
- validation
- UI mapping

AI must not mix these responsibilities.

---

## 7. RAW TEXT MUST BE PRESERVED

Every session includes raw_text.

This guarantees:

- auditability
- debugging
- user trust
- future re-parsing

AI must never remove raw_text storage.

---

## 8. VALIDATION IS MANDATORY

All parsing output must be schema validated.

Invalid output must be stored and inspected,
not silently corrected.

---

## 9. PROMPT EVOLUTION PROCESS

When improving parsing:

1. add failing example to corpus
2. run V4
3. identify failure stage
4. update prompt (new version)
5. compare outputs
6. document change reason

No blind edits.

---

## 10. DEFAULT AI CONFIRMATION

When asked to modify parsing, AI must first explain:

- which pipeline layer is affected
- risk to schema stability
- safer alternatives

Implementation only after approval.
