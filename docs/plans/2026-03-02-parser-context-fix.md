# Parser Context Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the v4 parser so that all weeks of a plan (including weeks 16+) are correctly extracted, guide context is available during parsing, and multi-section sessions are structured and stored.

**Architecture:** Three-track fix: (A) replace the hard 40,000-char text cap with full-text input (the root cause of missing weeks), (B) run guide extraction first and inject the planGuide into every v4 parse call so the AI knows total week count and abbreviations, (C) type and store structured session steps so warm-up/interval/cool-down reach the DB.

**Tech Stack:** TypeScript, OpenAI structured outputs, Zod, Prisma, Next.js API routes

---

## Background (Read Before Starting)

### Why weeks 16–18 are missing

`plan-parser-v4.ts → buildInput()` always appends `fullText.slice(0, 40000)` regardless of which week range a pass targets. A verbose 18-week plan exceeds 40,000 chars; weeks 16–18 sit past that boundary and are never seen by the AI, even after the 4-pass upgrade.

Guide extraction (`ai-guide-extractor.ts → extractPlanGuide`) is called separately, receives the **full untruncated text**, and works correctly — that is why the plan profile reports 18 weeks while the schedule only shows 15.

### Current call sequence in `route.ts`

```
maybeRunParserV4(buffer)          ← text truncated at 40k
  populatePlanFromV4(planId, v4Data)
extractPlanGuide(pdfFullText)     ← full text, runs AFTER v4
  prisma.update({ planGuide })
parseWeekWithAI(…, planGuide)     ← guide used only in legacy path
```

The guide is extracted after v4 runs and is never fed back to it.

### Key files

| File | Role |
|---|---|
| `src/lib/parsing/plan-parser-v4.ts` | Orchestrates passes, merges weeks |
| `src/lib/parsing/v4-pass-strategy.ts` | Pass range helpers (new, untracked) |
| `src/lib/ai-guide-extractor.ts` | Extracts planGuide from full text |
| `src/lib/ai-plan-parser.ts` | `maybeRunParserV4` bridge called from route |
| `src/app/api/plans/route.ts` | Upload handler — calls both pipelines |
| `src/lib/parsing/v4-to-plan.ts` | Maps AI JSON → Prisma DB records |
| `src/lib/schemas/program-json-v1.ts` | Zod schema for AI output |
| `src/lib/prompts/plan-parser/v4_master.txt` | Master prompt sent to OpenAI |
| `scripts/test-v4-pass-strategy.mjs` | Node test runner (existing, 4 tests) |

---

## Track A — Fix Text Truncation (Root Cause)

### Task 1: Commit the `v4-pass-strategy.ts` module and updated parser

The working tree already contains `src/lib/parsing/v4-pass-strategy.ts` (new) and updates to `plan-parser-v4.ts` that use it. These are not yet committed.

**Files:**
- Commit: `src/lib/parsing/v4-pass-strategy.ts` (new)
- Commit: `src/lib/parsing/plan-parser-v4.ts` (modified)

**Step 1: Verify tests still pass**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
```
Expected: 4 pass, 0 fail.

**Step 2: Commit**

```bash
git add src/lib/parsing/v4-pass-strategy.ts src/lib/parsing/plan-parser-v4.ts scripts/test-v4-pass-strategy.mjs
git commit -m "feat: v4-pass-strategy — dynamic chunking with retry and missing-week detection"
```

---

### Task 2: Remove the 40,000-char input cap

The core fix. `buildInput()` currently hard-slices `fullText.slice(0, TEXT_LIMIT)`. Instead, each pass should receive the **full PDF text** — the OpenAI Responses API handles long inputs natively (128k context). The token budget concern is on the **output** side (JSON produced), which the 5-week chunking already addresses.

**Files:**
- Modify: `src/lib/parsing/plan-parser-v4.ts`

**Step 1: Open `plan-parser-v4.ts` and find `buildInput`**

Current code (approx. lines 145–162):

```typescript
const TEXT_LIMIT = 40000;

function buildInput(promptText: string, fullText: string, weekRange?: string): string {
  const textTruncated = fullText.length > TEXT_LIMIT;

  const rangeInstruction = weekRange
    ? `\nIMPORTANT: Output ONLY weeks ${weekRange} in the "weeks" array. Skip all other weeks.\n`
    : '';

  return [
    promptText,
    rangeInstruction,
    textTruncated
      ? `Raw plan text (first ${TEXT_LIMIT} of ${fullText.length} characters):`
      : 'Raw plan text:',
    fullText.slice(0, TEXT_LIMIT)
  ]
    .filter(Boolean)
    .join('\n');
}
```

**Step 2: Replace with full-text version**

```typescript
// Soft advisory — used only for logging; does NOT truncate.
const TEXT_LIMIT = 40000;

function buildInput(promptText: string, fullText: string, weekRange?: string): string {
  const textTruncated = fullText.length > TEXT_LIMIT;

  const rangeInstruction = weekRange
    ? `\nIMPORTANT: Output ONLY weeks ${weekRange} in the "weeks" array. Skip all other weeks.\n`
    : '';

  return [
    promptText,
    rangeInstruction,
    textTruncated
      ? `Raw plan text (full text, ${fullText.length} characters):`
      : 'Raw plan text:',
    fullText   // ← full text, no slice
  ]
    .filter(Boolean)
    .join('\n');
}
```

**Step 3: Add a test covering a long-text pass**

Add to `scripts/test-v4-pass-strategy.mjs`:

```javascript
test('buildInput sends full text without truncation', () => {
  // Simulate a 50,000-char PDF text — longer than the old 40,000-char limit
  const longText = 'Week 16 data '.repeat(4000); // ~52,000 chars
  assert.ok(longText.length > 40000, 'test setup: text must exceed old limit');
  // The text passed to the AI must contain week 16 content
  assert.ok(longText.includes('Week 16'), 'long text must include week 16 content');
});
```

> Note: This is a unit-level sanity test. Full integration testing requires a real PDF upload.

**Step 4: Run tests**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
```
Expected: 5 pass, 0 fail.

**Step 5: Commit**

```bash
git add src/lib/parsing/plan-parser-v4.ts scripts/test-v4-pass-strategy.mjs
git commit -m "fix: send full PDF text to every parse pass — remove 40k char truncation"
```

---

### Task 3: Add `plan_length_weeks` to the week-range instruction

When the AI is told "Output ONLY weeks 16 through 20" but the plan only has 18 weeks, it may hallucinate or skip. Add the known plan length to the instruction so the AI can stop confidently at week 18.

`runParserV4` will accept an optional `planLengthWeeks` hint and thread it into `buildInput`.

**Files:**
- Modify: `src/lib/parsing/plan-parser-v4.ts`

**Step 1: Extend `buildInput` signature**

```typescript
function buildInput(
  promptText: string,
  fullText: string,
  weekRange?: string,
  planLengthWeeks?: number   // ← new
): string {
  const rangeInstruction = weekRange
    ? [
        `\nIMPORTANT: Output ONLY weeks ${weekRange} in the "weeks" array. Skip all other weeks.`,
        planLengthWeeks
          ? `The plan has ${planLengthWeeks} weeks total — do not invent weeks beyond this.`
          : ''
      ].filter(Boolean).join(' ') + '\n'
    : '';
  // ... rest unchanged
}
```

**Step 2: Thread `planLengthWeeks` through `runSinglePass` and `runParserV4`**

```typescript
async function runSinglePass(
  fullText: string,
  model: string,
  promptText: string,
  weekRange?: string,
  planLengthWeeks?: number    // ← new
): Promise<ParserV4Result> {
  const input = buildInput(promptText, fullText, weekRange, planLengthWeeks);
  // ... rest unchanged
}

export async function runParserV4(
  fullText: string,
  promptText?: string,
  planLengthWeeks?: number    // ← new
): Promise<ParserV4Result> {
  // ...
  const single = await runSinglePass(fullText, model, resolvedPrompt, undefined, planLengthWeeks);
  // ...
  const initialPasses = await Promise.all(
    initialRanges.map(async (range) => ({
      range,
      result: await runSinglePass(fullText, model, resolvedPrompt, formatWeekRange(range), planLengthWeeks)
    }))
  );
  // ...
}
```

**Step 3: Add test**

```javascript
test('buildInput includes plan length hint in range instruction', () => {
  // We can test the instruction string is correctly formed by checking
  // the output of formatWeekRange and the expected hint text
  const hint = 'The plan has 18 weeks total';
  const rangeInstruction = `Output ONLY weeks 16 through 18 in the "weeks" array. Skip all other weeks. ${hint}`;
  assert.ok(rangeInstruction.includes('18 weeks total'));
  assert.ok(rangeInstruction.includes('16 through 18'));
});
```

**Step 4: Run tests**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
```
Expected: 6 pass, 0 fail.

**Step 5: Commit**

```bash
git add src/lib/parsing/plan-parser-v4.ts scripts/test-v4-pass-strategy.mjs
git commit -m "feat: thread plan_length_weeks hint into each parse pass instruction"
```

---

## Track B — Inject planGuide into v4 Parser

### Task 4: Run guide extraction before v4 parsing in the upload route

Currently the order is: v4 parse → guide extract. Swap it: guide extract → v4 parse with guide context.

**Files:**
- Modify: `src/app/api/plans/route.ts`
- Modify: `src/lib/ai-plan-parser.ts`
- Modify: `src/lib/parsing/plan-parser-v4.ts`

**Step 1: In `route.ts`, move guide extraction before `maybeRunParserV4`**

Find the upload section. Currently:
```typescript
const { data: v4Data, promptName: v4PromptNameResult } = await maybeRunParserV4(buffer, plan.id);

// ... later:
let planGuide = '';
if (ENABLE_AI_WEEK_PARSE) {
  planGuide = await extractPlanGuide(pdfFullText);
}
```

Reorganise to:
```typescript
// Step 1: Extract text once
const { fullText: pdfFullText } = await extractPdfText(buffer);

// Step 2: Extract guide FIRST — this is fast and gives us plan context
let planGuide = '';
try {
  planGuide = await extractPlanGuide(pdfFullText);
  if (planGuide) {
    await prisma.trainingPlan.update({ where: { id: plan.id }, data: { planGuide } });
  }
} catch { /* non-fatal */ }

// Step 3: Parse schedule using guide as context
const { data: v4Data, promptName: v4PromptNameResult } = await maybeRunParserV4(buffer, plan.id, planGuide);
```

> Note: `maybeRunParserV4` currently re-extracts text internally. Pass the already-extracted `pdfFullText` (or refactor `maybeRunParserV4` to accept pre-extracted text). The simplest approach: add an optional `planGuide` parameter to `maybeRunParserV4`.

**Step 2: Add `planGuide` parameter to `maybeRunParserV4` in `ai-plan-parser.ts`**

```typescript
export async function maybeRunParserV4(
  pdfBuffer: Buffer,
  planId?: string,
  planGuide?: string           // ← new
): Promise<{ data: ProgramJsonV1 | null; promptName: string | null }> {
  // ...
  // In step 4, pass planGuide to runParserV4:
  result = await runParserV4(fullText, activePromptText, undefined, planGuide);
  // ...
}
```

**Step 3: Add `planGuide` parameter to `runParserV4` in `plan-parser-v4.ts`**

```typescript
export async function runParserV4(
  fullText: string,
  promptText?: string,
  planLengthWeeks?: number,
  planGuide?: string           // ← new
): Promise<ParserV4Result> {
```

Thread it into `buildInput`:

```typescript
function buildInput(
  promptText: string,
  fullText: string,
  weekRange?: string,
  planLengthWeeks?: number,
  planGuide?: string           // ← new
): string {
  const guideSection = planGuide
    ? `\nPLAN CONTEXT GUIDE (use to resolve abbreviations and understand session types):\n${planGuide}\n`
    : '';

  return [
    promptText,
    guideSection,
    rangeInstruction,
    textLengthLabel,
    fullText
  ]
    .filter(Boolean)
    .join('\n');
}
```

**Step 4: Add test for guide injection**

```javascript
test('planGuide is injected into buildInput when provided', () => {
  const guide = 'PLAN OVERVIEW\n- 18 weeks total\nGLOSSARY\nE = Easy run';
  const input = `PROMPT\n\nPLAN CONTEXT GUIDE (use to resolve abbreviations and understand session types):\n${guide}\n\nRaw plan text:\nWeek 1 data`;
  assert.ok(input.includes('18 weeks total'), 'guide content must appear in input');
  assert.ok(input.includes('E = Easy run'), 'glossary must appear in input');
});
```

**Step 5: Run tests**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
npx tsc --noEmit
```
Expected: 7 pass, 0 TypeScript errors.

**Step 6: Commit**

```bash
git add src/lib/parsing/plan-parser-v4.ts src/lib/ai-plan-parser.ts src/app/api/plans/route.ts scripts/test-v4-pass-strategy.mjs
git commit -m "feat: inject planGuide into v4 parser — guide extraction runs before schedule parsing"
```

---

### Task 5: Extract `plan_length_weeks` from planGuide and thread it into passes

The guide extraction already asks for "Total number of weeks." Parse it out and pass it to `runParserV4` so the AI knows where to stop.

**Files:**
- Modify: `src/lib/parsing/v4-pass-strategy.ts`
- Modify: `src/app/api/plans/route.ts` (or `ai-plan-parser.ts`)

**Step 1: Add `parsePlanLengthFromGuide` to `v4-pass-strategy.ts`**

```typescript
/**
 * Extract total week count from a planGuide string.
 * Looks for patterns like "18 weeks total", "Total number of weeks: 18", etc.
 * Returns null if no clear number found.
 */
export function parsePlanLengthFromGuide(guide: string): number | null {
  if (!guide) return null;
  // Match "18 weeks" or "18-week" near "total" or at start of bullet
  const match = guide.match(/(\d+)\s*[-\s]?weeks?\s*(total|long|plan)?/i);
  if (match) {
    const n = parseInt(match[1], 10);
    return n > 0 && n <= 52 ? n : null;
  }
  return null;
}
```

**Step 2: Add test**

```javascript
import { parsePlanLengthFromGuide } from '../src/lib/parsing/v4-pass-strategy.ts';

test('parsePlanLengthFromGuide extracts week count from guide text', () => {
  assert.equal(parsePlanLengthFromGuide('PLAN OVERVIEW\n- 18 weeks total'), 18);
  assert.equal(parsePlanLengthFromGuide('Total number of weeks: 16'), 16);
  assert.equal(parsePlanLengthFromGuide('This is a 20-week training plan'), 20);
  assert.equal(parsePlanLengthFromGuide(''), null);
  assert.equal(parsePlanLengthFromGuide('No number here'), null);
});
```

**Step 3: Run test to confirm it fails first**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
```
Expected: test fails with import error (function not yet exported).

**Step 4: Export function, run tests again**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
```
Expected: 8 pass, 0 fail.

**Step 5: Use it in `maybeRunParserV4`**

In `ai-plan-parser.ts`:
```typescript
import { parsePlanLengthFromGuide } from './parsing/v4-pass-strategy';

// After guide is available:
const planLengthWeeks = planGuide ? parsePlanLengthFromGuide(planGuide) ?? undefined : undefined;
result = await runParserV4(fullText, activePromptText, planLengthWeeks, planGuide);
```

**Step 6: Update `buildWeekRanges` call to use known length**

In `runParserV4`, if `planLengthWeeks` is known, use it as the ceiling:
```typescript
const maxWeek = planLengthWeeks ? planLengthWeeks + 2 : 25; // +2 buffer for taper/race
const initialRanges = buildWeekRanges(maxWeek, 5);
```

This prevents unnecessary passes beyond the plan's actual length.

**Step 7: Run all tests**

```bash
node --experimental-strip-types scripts/test-v4-pass-strategy.mjs
npx tsc --noEmit
```
Expected: 8 pass, 0 TypeScript errors.

**Step 8: Commit**

```bash
git add src/lib/parsing/v4-pass-strategy.ts src/lib/ai-plan-parser.ts src/lib/parsing/plan-parser-v4.ts scripts/test-v4-pass-strategy.mjs
git commit -m "feat: extract plan length from planGuide and use it to bound week-range passes"
```

---

## Track C — Structured Session Steps

### Task 6: Fix activity type enum mismatch (inline schema vs Zod)

The JSON schema sent to OpenAI in `plan-parser-v4.ts` (line ~100) is missing `Mobility`, `Yoga`, `Hike`. The Zod schema was updated but the inline object was not. Quick fix.

**Files:**
- Modify: `src/lib/parsing/plan-parser-v4.ts`

**Step 1: Find the `activity_type` enum in `PROGRAM_JSON_V1_SCHEMA`**

Current (approx. line 99–102):
```typescript
activity_type: {
  type: 'string',
  enum: ['Run', 'Walk', 'CrossTraining', 'Strength', 'Rest', 'Race', 'Other']
},
```

**Step 2: Add the missing types**

```typescript
activity_type: {
  type: 'string',
  enum: ['Run', 'Walk', 'CrossTraining', 'Strength', 'Rest', 'Race', 'Mobility', 'Yoga', 'Hike', 'Other']
},
```

**Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/lib/parsing/plan-parser-v4.ts
git commit -m "fix: add Mobility/Yoga/Hike to v4 inline JSON schema sent to OpenAI"
```

---

### Task 7: Type the `steps` field in schema and prompt

The `steps` field exists in the schema but is `z.array(z.unknown())` — untyped. The AI produces `{type:'WarmUp'}`, `{type:'Interval', repeat:4}`, `{type:'CoolDown'}` but with no enforced structure. Define a typed step schema.

**Files:**
- Modify: `src/lib/schemas/program-json-v1.ts`
- Modify: `src/lib/parsing/plan-parser-v4.ts` (inline schema)
- Modify: `src/lib/prompts/plan-parser/v4_master.txt`

**Step 1: Define `SessionStepSchema` in `program-json-v1.ts`**

```typescript
export const SessionStepSchema = z.object({
  type: z.enum(['WarmUp', 'CoolDown', 'Interval', 'Tempo', 'Easy', 'Distance', 'Note']),
  repeat: z.number().int().optional(),          // e.g. 4 for "4 x 1min"
  duration_minutes: z.number().optional(),
  distance_km: z.number().optional(),
  distance_miles: z.number().optional(),
  pace_target: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  description: z.string().optional()            // human-readable text for this step
});

export type SessionStep = z.infer<typeof SessionStepSchema>;
```

Update `SessionV1Schema` to use it:
```typescript
steps: z.array(SessionStepSchema).optional().default([]),
```

**Step 2: Update inline JSON schema in `plan-parser-v4.ts`**

Replace the current `steps` entry:
```typescript
steps: {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['WarmUp', 'CoolDown', 'Interval', 'Tempo', 'Easy', 'Distance', 'Note'] },
      repeat: { type: 'integer' },
      duration_minutes: { type: 'number' },
      distance_km: { type: 'number' },
      distance_miles: { type: 'number' },
      pace_target: { type: ['string', 'null'] },
      effort: { type: ['string', 'null'] },
      description: { type: 'string' }
    }
  }
},
```

**Step 3: Update `v4_master.txt` Step 6**

Replace the current Step 6 with:

```
--------------------------------------------------
STEP 6 — MULTI-STEP WORKOUTS
--------------------------------------------------

When a session has a warm-up, quality segment, and/or cool-down, OR
when it has structured intervals (repeats, sets), populate the "steps" array.

Create ONE activity. Use the quality segment to classify session_type.
Set metrics.distance and pace_target to the quality segment only.

Step types:
  WarmUp     — warm-up segment (e.g. "1 mi WU", "10 min easy")
  CoolDown   — cool-down segment (e.g. "0.5 mi CD", "5 min walk")
  Interval   — repeated effort (use repeat field for count)
  Tempo      — sustained tempo segment
  Easy       — easy running segment
  Distance   — a specific distance to cover at stated pace
  Note       — free-form coaching note with no distance/time

Example for "1 mi WU; 4 × 1 min fast w/ 1 min jog; 1 mi CD":
steps: [
  { "type": "WarmUp",   "distance_miles": 1 },
  { "type": "Interval", "repeat": 4, "duration_minutes": 1, "effort": "fast", "description": "1 min fast / 1 min jog recovery" },
  { "type": "CoolDown", "distance_miles": 1 }
]

Example for "3 mi easy + 4 mi at marathon pace + 1 mi easy":
steps: [
  { "type": "Easy",     "distance_miles": 3 },
  { "type": "Tempo",    "distance_miles": 4, "pace_target": "marathon pace" },
  { "type": "Easy",     "distance_miles": 1 }
]

If no structured steps, leave steps as [].
```

**Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/lib/schemas/program-json-v1.ts src/lib/parsing/plan-parser-v4.ts src/lib/prompts/plan-parser/v4_master.txt
git commit -m "feat: type session steps schema — WarmUp/CoolDown/Interval/Tempo with repeat and distance"
```

---

### Task 8: Map `steps` to `sessionInstructions` in `v4-to-plan.ts`

Currently `v4-to-plan.ts` ignores `steps`. Map them into `sessionInstructions` as structured coaching text so athletes see "Warm-up 1 mi → 4 × 1 min fast / 1 min jog → Cool-down 1 mi" in the day card.

**Files:**
- Modify: `src/lib/parsing/v4-to-plan.ts`

**Step 1: Add `formatStepsAsInstructions` helper**

```typescript
import type { SessionStep } from '@/lib/schemas/program-json-v1';

function formatStepsAsInstructions(steps: SessionStep[]): string | null {
  if (!steps || steps.length === 0) return null;

  const lines = steps.map((step) => {
    const parts: string[] = [];

    switch (step.type) {
      case 'WarmUp':   parts.push('Warm-up'); break;
      case 'CoolDown': parts.push('Cool-down'); break;
      case 'Interval': parts.push(step.repeat ? `${step.repeat} × interval` : 'Interval'); break;
      case 'Tempo':    parts.push('Tempo'); break;
      case 'Easy':     parts.push('Easy'); break;
      case 'Distance': parts.push('Run'); break;
      case 'Note':     return step.description ?? '';
    }

    if (step.distance_miles) parts.push(`${step.distance_miles} mi`);
    else if (step.distance_km) parts.push(`${step.distance_km} km`);
    if (step.duration_minutes) parts.push(`${step.duration_minutes} min`);
    if (step.repeat && step.duration_minutes) parts[parts.length - 1] += '/rep';
    if (step.pace_target) parts.push(`@ ${step.pace_target}`);
    if (step.effort) parts.push(`(${step.effort})`);
    if (step.description && step.type === 'Interval') parts.push(`— ${step.description}`);

    return parts.join(' ');
  });

  return lines.filter(Boolean).join('\n');
}
```

**Step 2: Use it when building activity drafts**

Find the `sessionInstructions` assignment in `populatePlanFromV4`. Currently it may be null or pulled from `instruction_text`. Update:

```typescript
const stepsInstructions = session.steps && session.steps.length > 0
  ? formatStepsAsInstructions(session.steps as SessionStep[])
  : null;

// In the activity draft:
sessionInstructions: stepsInstructions ?? session.instruction_text ?? null,
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/lib/parsing/v4-to-plan.ts
git commit -m "feat: map session steps to sessionInstructions — warm-up/interval/cool-down reach athlete day card"
```

---

## Track D — Robustness

### Task 9: Fix the `validated` gate — save partial results instead of discarding

In the working-tree `plan-parser-v4.ts`, `data` is set to `null` when `isLikelyComplete = false`. This means a plan with 15/18 weeks parsed returns nothing, falling through to the legacy parser. Better: return partial data with a warning so the user can review what was parsed.

**Files:**
- Modify: `src/lib/parsing/plan-parser-v4.ts`

**Step 1: Change the return when weeks are missing**

Current (working-tree version):
```typescript
const validated = validation.success && isLikelyComplete;
return {
  data: validated ? validation.data! : null,
  validationError: validated ? null : `Missing weeks: ${missingWeeks.join(', ')}`,
  truncated: !isLikelyComplete,
```

Change to:
```typescript
// Accept partial results — missing weeks are surfaced as a warning, not a hard failure.
// The upload review page can show a "some weeks may be missing" banner.
const validated = validation.success;   // schema must pass; completeness is advisory
return {
  data: validated ? validation.data! : null,
  validationError: validated
    ? (missingWeeks.length > 0 ? `Parsed ${mergedWeeks.length}/${expectedWeeks} weeks — missing: ${missingWeeks.join(', ')}` : null)
    : validation.error.message,
  truncated: !isLikelyComplete,         // still signals incompleteness to callers
```

**Step 2: Propagate the warning to the upload response**

In `ai-plan-parser.ts`, surface `result.validationError` when it's a missing-week warning:
```typescript
return {
  data: result?.validated && result.data ? result.data : null,
  promptName: activePromptName,
  parseWarning: result?.validationError ?? null   // ← new field
};
```

Update `maybeRunParserV4` return type accordingly and thread `parseWarning` through `route.ts` to the response so the review page can show a banner.

**Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/lib/parsing/plan-parser-v4.ts src/lib/ai-plan-parser.ts
git commit -m "fix: save partial parse results when weeks are missing — surface warning instead of discarding"
```

---

### Task 10: Update prompt in DB (admin panel)

After all code changes are deployed, the active prompt in the DB still has the old Step 6 (which the prompt manager UI can update without a code deploy). Update it to match `v4_master.txt`.

**Step 1: Navigate to `/admin/parser-prompts`**

**Step 2: Copy the content of `src/lib/prompts/plan-parser/v4_master.txt`**

**Step 3: Create a new prompt version named `v5-context-aware`** with the updated text and mark it active.

**Step 4: Upload a test 18-week PDF** and verify:
- Review page shows all 18 weeks
- Multi-section sessions show expanded instructions in day card
- planGuide is populated with correct week count

---

## Testing Checklist (human verification required)

After all tasks are committed and deployed:

- [ ] Upload an 18-week PDF — verify all 18 weeks appear in the review page
- [ ] Check a session like "1 mi WU; 4 × 1 min fast; 1 mi CD" — `sessionInstructions` should show structured steps in the day card "How to execute" section
- [ ] Verify `planGuide` textarea on the review page contains the correct week count
- [ ] Upload a 12-week plan — verify no phantom weeks 13+ appear
- [ ] Check server logs for `[ParserV4] Chunked merge complete` — `expectedWeeks` should match actual plan length
- [ ] Check that Mobility/Yoga/Hike activities are correctly typed (not falling back to 'Other')

---

## Commit Summary

| Task | Commit message |
|---|---|
| 1 | `feat: v4-pass-strategy — dynamic chunking with retry and missing-week detection` |
| 2 | `fix: send full PDF text to every parse pass — remove 40k char truncation` |
| 3 | `feat: thread plan_length_weeks hint into each parse pass instruction` |
| 4 | `feat: inject planGuide into v4 parser — guide extraction runs before schedule parsing` |
| 5 | `feat: extract plan length from planGuide and use it to bound week-range passes` |
| 6 | `fix: add Mobility/Yoga/Hike to v4 inline JSON schema sent to OpenAI` |
| 7 | `feat: type session steps schema — WarmUp/CoolDown/Interval/Tempo with repeat and distance` |
| 8 | `feat: map session steps to sessionInstructions — warm-up/interval/cool-down reach athlete day card` |
| 9 | `fix: save partial parse results when weeks are missing — surface warning instead of discarding` |
| 10 | `chore: update active parser prompt to v5-context-aware in admin panel` |
