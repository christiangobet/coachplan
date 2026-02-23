---
wave: 2
depends_on: [01-schema-PLAN]
files_modified:
  - src/lib/ai-plan-parser.ts
  - src/lib/ai-guide-extractor.ts (new)
  - src/app/api/plans/route.ts
autonomous: true
---

# Plan 02 — Two-Pass Parser: Guide Extraction + Context-Aware Schedule Parsing

## Goal
On every new PDF upload: (1) extract a structured Plan Context Document into `planGuide`, (2) use that guide as context when parsing the weekly schedule so `instruction_text` is properly expanded, and (3) store the expanded `instruction_text` as `sessionInstructions` on each activity — separate from `rawText`.

## Context

### Current flow (single pass)
```
PDF bytes → extract text → parseWeekWithAI(week cells) → save activities
```
`instruction_text` from the AI is currently merged into `rawText` (see `displayRawText` in `route.ts` ~line 1188). It is NOT saved separately.

### New flow (two passes)
```
PDF bytes → extract text
  → Pass 1: extractPlanGuide(fullText) → planGuide (stored on TrainingPlan)
  → Pass 2: parseWeekWithAI(week cells, planGuide as legend) → activities
               instruction_text → sessionInstructions (stored separately)
               raw_text → rawText (unchanged, stays terse)
```

### Key files
- `src/lib/ai-plan-parser.ts` — contains `parseWeekWithAI` and `WEEK_SCHEMA`
- `src/app/api/plans/route.ts` — upload handler, calls `parseWeekWithAI` per week, builds activity drafts
  - `buildActivityDrafts()` ~line 1182 — maps AI output to DB fields
  - `parseWeekWithAI` call sites — need `planGuide` threaded through

## Tasks

<task id="02.1" name="Create src/lib/ai-guide-extractor.ts">
Create a new file `src/lib/ai-guide-extractor.ts` with a single exported function:

```typescript
export async function extractPlanGuide(rawText: string): Promise<string>
```

This function makes one OpenAI call (use `openaiTextCompletion` or equivalent from `src/lib/openai.ts` — check what's available) with the following prompt structure:

**System message:**
```
You are a training plan analyst. Extract all reusable knowledge from the following training plan text.
Output plain text organized under these headings (omit any heading if no content found):

PLAN OVERVIEW
- Total number of weeks
- Training phases and their week ranges (e.g. Base: weeks 1-4, Build: weeks 5-10, Peak: weeks 11-14, Taper: weeks 15-16)
- Target race type and distance (if stated)
- Athlete level this plan targets (if stated)
- Overall load progression logic (e.g. 3 weeks build + 1 recovery)
- Typical week structure (which days are rest, quality, long run)

GLOSSARY & ABBREVIATIONS
- One entry per line: ABBREV = full definition (e.g. E = Easy run at conversational pace)
- Include pace labels, effort labels, session type codes, workout notation

PACE ZONES
- One entry per line: Label = pace range or HR range or RPE (e.g. Easy = 6:00-6:30/km or 65-70% HR max)

NAMED SESSIONS & CIRCUITS
- For each named session/circuit: name followed by full description or exercise list

GENERAL INSTRUCTIONS
- Coach notes, adaptation rules, what to do when sick or tired, how to handle missed sessions
```

**User message:** the full `rawText`

The function should return the model's response as a plain string. If the call fails, return an empty string (never throw).

Use `gpt-4o-mini` as the model (same as the rest of the app). Cap at 2000 tokens output max.
</task>

<task id="02.2" name="Add planGuide parameter to parseWeekWithAI">
In `src/lib/ai-plan-parser.ts`, modify `parseWeekWithAI`:

1. Add `planGuide?: string` to the args type
2. In the prompt assembly (the `input` array), add the guide after the existing `legend` line:
```typescript
args.planGuide ? `Plan context guide (use to resolve abbreviations and expand instructions):\n${args.planGuide}` : "",
```
3. Update the system instruction to mention: "Use the plan context guide to resolve abbreviations in raw cells and write detailed instruction_text."

Do not change `WEEK_SCHEMA` — `instruction_text` field already exists.
</task>

<task id="02.3" name="Store sessionInstructions separately in buildActivityDrafts">
In `src/app/api/plans/route.ts`, in `buildActivityDrafts()` (~line 1182):

Current behavior:
```typescript
const instructionText = normalizeWhitespace(String(a.instruction_text || ''));
const displayRawText = instructionText || decodedRawText || null;
// displayRawText → rawText in draft
```

New behavior:
- Keep `rawText` as `decodedRawText` (the terse source text) — do NOT merge `instruction_text` into it
- Add `sessionInstructions` to the draft object: `instructionText || null`

Update the `ActivityDraft` type to include `sessionInstructions?: string | null` and pass it through to the `prisma.planActivity.create` / `createMany` call.

Search for where drafts are written to the DB (look for `planActivity.create` or `createMany` calls) and add `sessionInstructions: draft.sessionInstructions ?? null`.
</task>

<task id="02.4" name="Wire guide extraction into upload flow">
In `src/app/api/plans/route.ts`, in the POST upload handler:

1. After the full PDF text is extracted (before the per-week parse loop), call:
```typescript
const planGuide = await extractPlanGuide(fullRawText);
```

2. After the plan record is created (`prisma.trainingPlan.create`), update it with the guide:
```typescript
if (planGuide) {
  await prisma.trainingPlan.update({
    where: { id: plan.id },
    data: { planGuide }
  });
}
```

3. Pass `planGuide` to each `parseWeekWithAI` call:
```typescript
parseWeekWithAI({ ..., planGuide })
```

Handle the case where `extractPlanGuide` fails gracefully — if it returns empty string, skip the update and proceed without guide (don't block the upload).
</task>

<task id="02.5" name="Verify instruction_text quality with guide context">
Manual verification step: upload the existing test PDF (Blue Ridge 30K plan) and check that:
- `planGuide` is populated on the `TrainingPlan` record (check via Prisma Studio or a quick DB query)
- Activity `sessionInstructions` fields are populated with expanded text
- Activity `rawText` still contains the terse source text (not merged)
</task>

## Verification

- [ ] `src/lib/ai-guide-extractor.ts` exists and exports `extractPlanGuide`
- [ ] `parseWeekWithAI` accepts `planGuide?` and includes it in the prompt when present
- [ ] `buildActivityDrafts` sets `sessionInstructions` from `instruction_text` (not merged into `rawText`)
- [ ] Upload flow calls `extractPlanGuide` and saves result to `planGuide` on the plan
- [ ] Upload flow passes `planGuide` to each `parseWeekWithAI` call
- [ ] Upload still succeeds if `extractPlanGuide` fails (graceful degradation)
- [ ] TypeScript compiles without errors

## must_haves
- `rawText` on activities remains the terse source text — do NOT replace it with expanded text
- `sessionInstructions` is stored as a separate field
- Guide extraction failure must never block an upload
- `planGuide` is saved on the plan record after upload
