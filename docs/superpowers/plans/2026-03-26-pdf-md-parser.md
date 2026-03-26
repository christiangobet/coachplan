# PDF → MD Vision Extraction Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weak pdfjs text extractor with a Claude vision call that produces a structured, enriched Markdown intermediate (`plan.md`), then feed that MD to a simplified V4 parser — yielding richer activity descriptions, resolved abbreviations, preserved session structure, and captured supplementary content (strength circuits, trainer notes).

**Architecture:** A new `pdf-to-md.ts` module sends the raw PDF buffer to Claude's native PDF document API and receives enriched Markdown. A new `md-chunker.ts` splits the MD at `## Week N` headers (semantic boundaries) and prepends supplementary sections to every chunk. The simplified V4 parser consumes clean MD instead of raw text. All existing `v4-to-plan.ts` / Zod schemas / DB models are unchanged.

**Tech Stack:** `@anthropic-ai/sdk` (Claude claude-sonnet-4-5), Node `node:test` + `node:assert` for tests, existing Prisma/ProgramJsonV1 schema, existing `saveParseArtifact()` helper.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/pdf/pdf-to-md.ts` | Sends PDF buffer to Claude vision; returns enriched MD string |
| Create | `src/lib/parsing/md-chunker.ts` | Splits MD at `## Week N` headers; prepends supplementary sections to each chunk |
| Create | `src/lib/prompts/plan-parser/vision-extraction-prompt.ts` | System prompt for the vision extraction call |
| Create | `src/lib/prompts/plan-parser/md-parser-prompt.ts` | Simplified V4 prompt that expects clean MD input (no table reconstruction) |
| Create | `scripts/md-chunker.test.ts` | Unit tests for md-chunker (pure function, fully testable without I/O) |
| Create | `scripts/pdf-to-md.test.ts` | Unit tests for pdf-to-md (mocked Anthropic client) |
| Modify | `src/lib/feature-flags.ts` | Add `PARSER_VISION_EXTRACT` flag |
| Modify | `src/lib/ai-plan-parser.ts` | Add `maybeRunVisionExtract()` function wired behind the flag |
| Modify | `package.json` | Add `test:parsing` script; add `@anthropic-ai/sdk` dependency |

---

## Task 1: Install Dependencies + Feature Flag

**Files:**
- Modify: `package.json`
- Modify: `src/lib/feature-flags.ts`

- [ ] **Step 1: Install Anthropic SDK**

```bash
npm install @anthropic-ai/sdk
```

Expected output: `added N packages` — no errors.

- [ ] **Step 2: Add test script to package.json**

In `package.json`, inside `"scripts"`, add after the `test:parser-i18n` line:

```json
"test:parsing": "node --test --experimental-transform-types scripts/md-chunker.test.ts scripts/pdf-to-md.test.ts",
```

- [ ] **Step 3: Add PARSER_VISION_EXTRACT flag to `src/lib/feature-flags.ts`**

Add at the end of the `FLAGS` object (before `} as const`):

```typescript
  /**
   * Enables the vision-based PDF extraction pipeline.
   * When true, uploads run pdf-to-md.ts (Claude vision) → enriched plan.md → simplified V4 parser.
   * Set PARSER_VISION_EXTRACT=true to enable.
   */
  PARSER_VISION_EXTRACT: process.env.PARSER_VISION_EXTRACT === 'true',
```

- [ ] **Step 4: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/feature-flags.ts
git commit -m "feat: add Anthropic SDK + PARSER_VISION_EXTRACT flag"
```

---

## Task 2: `md-chunker.ts` + Tests

The chunker is a pure function with zero I/O — implement with TDD.

**Files:**
- Create: `src/lib/parsing/md-chunker.ts`
- Create: `scripts/md-chunker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/md-chunker.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { chunkMd, extractSupplementary, MdChunk } from "../src/lib/parsing/md-chunker.ts";

const SAMPLE_MD = `## Glossary
| Code | Full Description |
| T2 | 2×10min tempo @ 7:30/mile |

## Strength & Conditioning
A1. Single-leg squat — 3×8 each side.

## Trainer Notes
Key phase: base building.

## Week 1
| Day | Session | Distance | Notes |
| Mon | Easy run | 8km | Zone 2 |
| Tue | T2 session | 14km | Key |

## Week 2
| Day | Session | Distance | Notes |
| Mon | Rest | — | — |
| Wed | T2 session | 12km | Key |

## Week 3
| Day | Session | Distance | Notes |
| Mon | Long run | 20km | Easy pace |
`;

test("extractSupplementary returns all three supplementary sections", () => {
  const sup = extractSupplementary(SAMPLE_MD);
  assert.ok(sup.includes("## Glossary"));
  assert.ok(sup.includes("## Strength & Conditioning"));
  assert.ok(sup.includes("## Trainer Notes"));
  assert.ok(!sup.includes("## Week 1"));
});

test("extractSupplementary handles missing sections gracefully", () => {
  const md = `## Glossary\n| Code | Full |\n\n## Week 1\n| Day | Session |\n`;
  const sup = extractSupplementary(md);
  assert.ok(sup.includes("## Glossary"));
  assert.ok(!sup.includes("## Strength & Conditioning"));
  assert.ok(!sup.includes("## Week 1"));
});

test("chunkMd returns single chunk when plan has fewer weeks than chunkSize", () => {
  const chunks = chunkMd(SAMPLE_MD, 5);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].weekNumbers.includes(1));
  assert.ok(chunks[0].weekNumbers.includes(2));
  assert.ok(chunks[0].weekNumbers.includes(3));
});

test("chunkMd splits into multiple chunks when plan exceeds chunkSize", () => {
  // Build a 12-week plan
  let bigMd = "## Glossary\n| Code | Full |\n\n";
  for (let i = 1; i <= 12; i++) {
    bigMd += `## Week ${i}\n| Day | Session |\n| Mon | Easy run |\n\n`;
  }
  const chunks = chunkMd(bigMd, 5);
  assert.equal(chunks.length, 3); // weeks 1-5, 6-10, 11-12
  assert.deepEqual(chunks[0].weekNumbers, [1, 2, 3, 4, 5]);
  assert.deepEqual(chunks[1].weekNumbers, [6, 7, 8, 9, 10]);
  assert.deepEqual(chunks[2].weekNumbers, [11, 12]);
});

test("every chunk includes supplementary sections as prefix", () => {
  let bigMd = "## Glossary\n| Code | Full |\n\n## Trainer Notes\nBase phase.\n\n";
  for (let i = 1; i <= 6; i++) {
    bigMd += `## Week ${i}\n| Day | Session |\n| Mon | Easy |\n\n`;
  }
  const chunks = chunkMd(bigMd, 3);
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.ok(chunk.text.startsWith("## Glossary"), `chunk for weeks ${chunk.weekNumbers} missing Glossary prefix`);
    assert.ok(chunk.text.includes("## Trainer Notes"), `chunk for weeks ${chunk.weekNumbers} missing Trainer Notes`);
  }
});

test("chunkMd single-week mode produces one chunk per week", () => {
  const chunks = chunkMd(SAMPLE_MD, 1);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0].weekNumbers, [1]);
  assert.deepEqual(chunks[1].weekNumbers, [2]);
  assert.deepEqual(chunks[2].weekNumbers, [3]);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:parsing
```

Expected: error `Cannot find module '../src/lib/parsing/md-chunker.ts'`

- [ ] **Step 3: Implement `src/lib/parsing/md-chunker.ts`**

```typescript
/**
 * Splits an enriched plan.md document into chunks bounded by ## Week N headers.
 * Supplementary sections (Glossary, Strength & Conditioning, Trainer Notes)
 * are prepended to every chunk so the parser always has full context.
 */

export interface MdChunk {
  /** The MD text for this chunk (supplementary prefix + week sections). */
  text: string;
  /** Which week numbers are included in this chunk. */
  weekNumbers: number[];
}

const SUPPLEMENTARY_HEADERS = ['## Glossary', '## Strength & Conditioning', '## Trainer Notes'];

/**
 * Extract the supplementary sections from the MD (everything before the first ## Week N).
 * Returns them as a single string to be prepended to every chunk.
 */
export function extractSupplementary(md: string): string {
  const firstWeekIdx = md.search(/^## Week \d+/m);
  if (firstWeekIdx === -1) return md.trim();

  const before = md.slice(0, firstWeekIdx);

  // Keep only lines that belong to a supplementary section
  const lines = before.split('\n');
  const kept: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const isSupHeader = SUPPLEMENTARY_HEADERS.some((h) => line.startsWith(h));
    if (isSupHeader) { inSection = true; }
    if (inSection) kept.push(line);
  }

  return kept.join('\n').trim();
}

/**
 * Split the MD into chunks of `chunkSize` weeks each.
 * Each chunk is prefixed with the supplementary sections.
 *
 * @param md        Full plan.md content.
 * @param chunkSize Maximum number of weeks per chunk (default: 5).
 */
export function chunkMd(md: string, chunkSize = 5): MdChunk[] {
  const supplementary = extractSupplementary(md);

  // Split into week sections
  const weekSections: Array<{ weekNumber: number; text: string }> = [];
  const weekRegex = /^(## Week (\d+)[\s\S]*?)(?=^## Week \d+|\s*$)/gm;

  let match: RegExpExecArray | null;
  while ((match = weekRegex.exec(md)) !== null) {
    weekSections.push({
      weekNumber: parseInt(match[2], 10),
      text: match[1].trimEnd()
    });
  }

  if (weekSections.length === 0) {
    // No week sections found — return the whole thing as one chunk
    return [{ text: md, weekNumbers: [] }];
  }

  // Group into chunks of chunkSize
  const chunks: MdChunk[] = [];
  for (let i = 0; i < weekSections.length; i += chunkSize) {
    const slice = weekSections.slice(i, i + chunkSize);
    const weekText = slice.map((s) => s.text).join('\n\n');
    const text = supplementary
      ? `${supplementary}\n\n${weekText}`
      : weekText;
    chunks.push({
      text,
      weekNumbers: slice.map((s) => s.weekNumber)
    });
  }

  return chunks;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:parsing
```

Expected: all `md-chunker` tests pass. `pdf-to-md` tests will fail (file doesn't exist yet) — that's fine.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/md-chunker.ts scripts/md-chunker.test.ts
git commit -m "feat: add md-chunker — semantic week-boundary splitting with supplementary prefix"
```

---

## Task 3: Vision Extraction Prompt

**Files:**
- Create: `src/lib/prompts/plan-parser/vision-extraction-prompt.ts`

- [ ] **Step 1: Create the extraction prompt**

Create `src/lib/prompts/plan-parser/vision-extraction-prompt.ts`:

```typescript
/**
 * System prompt for the Claude vision extraction call.
 * Instructs Claude to convert a training plan PDF into structured Markdown.
 * This prompt is used by pdf-to-md.ts.
 */
export const VISION_EXTRACTION_PROMPT = `You are a training plan extraction specialist. Convert the training plan PDF into a structured Markdown document. Extract ALL content faithfully — do not summarize or omit anything.

OUTPUT FORMAT — produce exactly these sections in this order:

---

## Glossary
A table of every abbreviation, code, effort zone, and term defined anywhere in the PDF (legend, key, footnotes, sidebar, last page, inline key).

| Code | Full Description |
|------|-----------------|
| ...  | ...             |

If no glossary exists, write: "No glossary found."

---

## Strength & Conditioning
Extract ALL strength training, mobility, cross-training, drill, or exercise descriptions verbatim.
Preserve exercise names, sets/reps, rest periods, and coaching cues exactly as written.
If no such section exists, omit this heading entirely.

---

## Trainer Notes
Extract ALL coaching narrative, race strategy, phase goals, pacing guidance, nutrition tips, or any text block outside the schedule grid that represents advice from the coach or plan author.
If no such content exists, omit this heading entirely.

---

## Week 1
## Week 2
... (one section per week)

For each week, produce a Markdown table:

| Day | Session | Distance | Duration | Notes |
|-----|---------|----------|----------|-------|

RULES FOR WEEK TABLES:
1. One row per session per day (multiple sessions = multiple rows with the same Day value).
2. Resolve ALL abbreviations inline using the Glossary. Example: "T2" becomes "T2: 2×10min @ tempo (7:30/mile), 5min jog recovery".
3. Expand session structure inline in the Session column: include warmup / main set / cooldown breakdown. Example: "WU 15min easy + 3×8min @ tempo + CD 10min easy".
4. When a cell references a supplementary routine (e.g., "Strength A"), write a brief inline summary in the Session column AND append "See Strength & Conditioning section" in Notes.
5. Preserve any per-day coaching notes verbatim in the Notes column.
6. Translate all non-English text to English in your output.
7. Days with no session: write "Rest" in Session, "—" in other columns.
8. If the plan uses color-coding or bold to indicate priority sessions, add "⭐ Key session" to Notes.
9. Do NOT invent, infer, or add content that is not present in the PDF.

---

IMPORTANT:
- Produce ALL weeks in the plan — do not stop early.
- If the PDF has multiple phases (base, build, peak, taper), output all of them as sequential weeks.
- The output must be valid Markdown only — no explanations, no preamble, no trailing commentary.
`;
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/plan-parser/vision-extraction-prompt.ts
git commit -m "feat: add vision extraction prompt for PDF→MD conversion"
```

---

## Task 4: `pdf-to-md.ts` + Tests

**Files:**
- Create: `src/lib/pdf/pdf-to-md.ts`
- Create: `scripts/pdf-to-md.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/pdf-to-md.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

// We test the module logic by exercising its public interface with a mocked Anthropic client.
// The actual Anthropic call is mocked via module-level injection.

test("extractPlanMd returns the text content from the Claude response", async () => {
  const fakeBuffer = Buffer.from("%PDF-1.4 fake content");
  const expectedMd = "## Glossary\n| Code | Full |\n\n## Week 1\n| Day | Session |\n";

  // Mock the Anthropic SDK
  const mockCreate = async (params: unknown) => {
    const p = params as { messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> };
    const firstContent = p.messages[0].content[0] as { type: string; source?: { data: string } };
    assert.equal(firstContent.type, "document");
    assert.equal(firstContent.source?.data, fakeBuffer.toString("base64"));
    return { content: [{ type: "text", text: expectedMd }] };
  };

  const { extractPlanMd } = await import("../src/lib/pdf/pdf-to-md.ts");
  const result = await extractPlanMd(fakeBuffer, mockCreate as never);
  assert.equal(result, expectedMd);
});

test("extractPlanMd throws a descriptive error when Claude returns no text block", async () => {
  const fakeBuffer = Buffer.from("%PDF-1.4 fake content");

  const mockCreate = async () => ({
    content: [{ type: "tool_use", id: "tu_1" }]
  });

  const { extractPlanMd } = await import("../src/lib/pdf/pdf-to-md.ts");
  await assert.rejects(
    () => extractPlanMd(fakeBuffer, mockCreate as never),
    /no text block/i
  );
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:parsing
```

Expected: error `Cannot find module '../src/lib/pdf/pdf-to-md.ts'`

- [ ] **Step 3: Implement `src/lib/pdf/pdf-to-md.ts`**

```typescript
// Server-side only — calls Anthropic API.
import Anthropic from '@anthropic-ai/sdk';
import { VISION_EXTRACTION_PROMPT } from '@/lib/prompts/plan-parser/vision-extraction-prompt';

export type AnthropicCreateFn = InstanceType<typeof Anthropic>['messages']['create'];

const MODEL = 'claude-sonnet-4-5-20251022';
const MAX_TOKENS = 16384;

/**
 * Convert a PDF buffer to an enriched Markdown training plan document.
 *
 * Uses Claude's native PDF document input — no page rendering, no canvas dependency.
 * The returned string matches the canonical MD format defined by VISION_EXTRACTION_PROMPT:
 *   ## Glossary / ## Strength & Conditioning / ## Trainer Notes / ## Week N sections.
 *
 * @param pdfBuffer Raw PDF bytes.
 * @param createFn  Anthropic messages.create — injectable for testing (defaults to real client).
 */
export async function extractPlanMd(
  pdfBuffer: Buffer,
  createFn?: AnthropicCreateFn
): Promise<string> {
  const client = createFn ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const create = createFn ?? client!.messages.create.bind(client!.messages);

  const response = await create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64')
            }
          } as never,
          {
            type: 'text',
            text: VISION_EXTRACTION_PROMPT
          }
        ]
      }
    ]
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[pdf-to-md] Claude returned no text block — check model and prompt');
  }

  return textBlock.text.trim();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:parsing
```

Expected: all `pdf-to-md` tests pass, all `md-chunker` tests still pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf/pdf-to-md.ts scripts/pdf-to-md.test.ts
git commit -m "feat: add pdf-to-md — Claude vision extraction producing enriched MD"
```

---

## Task 5: Simplified MD Parser Prompt

This prompt replaces the V4 default prompt when parsing MD input. It removes all table reconstruction, abbreviation, i18n, and layout detection instructions — those are handled upstream by the vision extractor.

**Files:**
- Create: `src/lib/prompts/plan-parser/md-parser-prompt.ts`

- [ ] **Step 1: Create the simplified prompt**

Create `src/lib/prompts/plan-parser/md-parser-prompt.ts`:

```typescript
/**
 * Simplified V4 prompt for parsing enriched Markdown input (not raw PDF text).
 * The MD has already been structured by the vision extractor:
 *   - Abbreviations resolved inline
 *   - Session structure expanded
 *   - Tables formatted with Day/Session/Distance/Duration/Notes columns
 * This prompt only needs to map that clean structure to ProgramJsonV1 schema.
 */
export const MD_PARSER_PROMPT = `You are an expert training plan parser. Convert the structured Markdown training plan into the required JSON schema.

The input is pre-processed Markdown with:
- A ## Glossary section (codes already resolved inline in session cells)
- Optional ## Strength & Conditioning and ## Trainer Notes sections
- One ## Week N section per week, each containing a table with columns: Day, Session, Distance, Duration, Notes

YOUR TASK:
1. Map each week table to a week object in the JSON.
2. Map each row to an activity object.
3. Extract distance and duration from their respective columns (convert to km if miles, convert to seconds for duration).
4. Parse the Session column for session steps (warmup / intervals / cooldown) into the steps array.
5. Use the Notes column for coaching notes and priority signals (⭐ = KEY priority).
6. Determine activity_type from session content: Run, Rest, CrossTraining, Strength, Mobility, Race, Yoga, Hike, or Other.
7. Extract pace targets and effort targets from session text (e.g. "Zone 2", "7:30/mile", "RPE 7").

RULES:
- Output ONLY valid JSON matching the schema — no explanations, no markdown fences.
- For Rest days: create a Rest activity with no distance/duration.
- Preserve the full session description in instruction_text even if you also parse steps.
- Use the raw Session + Notes cell text as raw_text.
- If a week has no table rows, skip it (do not output an empty week).
- The ## Glossary, ## Strength & Conditioning, and ## Trainer Notes sections are context — do not output them as activities. However, for Strength activities referenced in the schedule, populate steps[] from the Strength & Conditioning section.
`;
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/plan-parser/md-parser-prompt.ts
git commit -m "feat: add simplified MD parser prompt for vision pipeline"
```

---

## Task 6: `maybeRunVisionExtract()` in `ai-plan-parser.ts`

This wires everything together behind the `PARSER_VISION_EXTRACT` flag.

**Files:**
- Modify: `src/lib/ai-plan-parser.ts`

- [ ] **Step 1: Read the current file to understand the import block and function pattern**

Open `src/lib/ai-plan-parser.ts` and note:
- Line 1: `// Server-side only — calls AI APIs and DB.`
- The existing imports at the top
- The `maybeRunParserV4()` function at lines 219–327 as the pattern to follow

- [ ] **Step 2: Add imports at the top of `src/lib/ai-plan-parser.ts`**

After the existing imports, add:

```typescript
import { extractPlanMd } from '@/lib/pdf/pdf-to-md';
import { chunkMd } from '@/lib/parsing/md-chunker';
import { MD_PARSER_PROMPT } from '@/lib/prompts/plan-parser/md-parser-prompt';
```

- [ ] **Step 3: Add `maybeRunVisionExtract()` to `src/lib/ai-plan-parser.ts`**

Add this function after `maybeRunParserV5()`:

```typescript
/**
 * Vision extraction pipeline: PDF → enriched MD → simplified V4 parser.
 * Only runs when FLAGS.PARSER_VISION_EXTRACT is true.
 *
 * Flow:
 *   1. extractPlanMd() — Claude vision call, returns enriched plan.md
 *   2. Store plan.md as ParseArtifact type "EXTRACTED_MD"
 *   3. chunkMd() — split at ## Week N headers (5-week chunks)
 *   4. runParserV4() per chunk with MD_PARSER_PROMPT
 *   5. Merge results, return ProgramJsonV1
 */
export async function maybeRunVisionExtract(
  pdfBuffer: Buffer,
  planId?: string
): Promise<{ data: ProgramJsonV1 | null; parseWarning: string | null; extractedMd: string | null }> {
  if (!FLAGS.PARSER_VISION_EXTRACT) {
    return { data: null, parseWarning: null, extractedMd: null };
  }

  // ── Step 1: PDF → enriched MD ─────────────────────────────────────────────
  let planMd: string;
  try {
    planMd = await extractPlanMd(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[VisionExtract] extractPlanMd failed', { error: msg });
    return { data: null, parseWarning: `Vision extraction failed: ${msg}`, extractedMd: null };
  }

  // ── Step 2: Store plan.md as artifact ────────────────────────────────────
  let parseJobId: string | undefined;
  if (FLAGS.PARSE_DUAL_WRITE) {
    const job = await createParseJob({ planId, parserVersion: 'vision-v1' });
    parseJobId = job.id;
    await saveParseArtifact({
      parseJobId: job.id,
      artifactType: 'EXTRACTED_MD',
      schemaVersion: '1',
      json: { md: planMd },
      validationOk: true
    });
  }

  // ── Step 3: Chunk MD at ## Week N headers ─────────────────────────────────
  const chunks = chunkMd(planMd, 5);
  console.info('[VisionExtract] MD chunked', { chunks: chunks.length });

  // ── Step 4: Run V4 parser on each chunk with simplified prompt ────────────
  const passResults = await Promise.all(
    chunks.map(async (chunk) => {
      const result = await runParserV4(chunk.text, MD_PARSER_PROMPT);
      return { range: { start: chunk.weekNumbers[0] ?? 0, end: chunk.weekNumbers[chunk.weekNumbers.length - 1] ?? 0 }, data: result.data };
    })
  );

  const successfulPasses = passResults.filter((p): p is { range: { start: number; end: number }; data: ProgramJsonV1 } => p.data !== null);

  if (successfulPasses.length === 0) {
    const warning = 'Vision pipeline: all V4 chunk passes failed';
    if (parseJobId) await updateParseJobStatus(parseJobId, 'FAILED', warning);
    return { data: null, parseWarning: warning, extractedMd: planMd };
  }

  // ── Step 5: Merge results ─────────────────────────────────────────────────
  const mergedWeeks = mergeWeeksFromPasses(successfulPasses.map((p) => ({ data: p.data })));
  const merged: ProgramJsonV1 = {
    program: successfulPasses[0].data.program,
    weeks: mergedWeeks,
    quality_checks: { weeks_detected: mergedWeeks.length, missing_days: [], anomalies: [] }
  };

  const validation = ProgramJsonV1Schema.safeParse(merged);
  const data = validation.success ? validation.data : null;
  const parseWarning = !validation.success
    ? `Vision pipeline validation failed: ${validation.error.message}`
    : null;

  if (parseJobId) {
    await saveParseArtifact({
      parseJobId,
      artifactType: 'V4_OUTPUT',
      schemaVersion: '1',
      json: merged,
      validationOk: validation.success
    });
    await updateParseJobStatus(parseJobId, validation.success ? 'SUCCESS' : 'FAILED', parseWarning ?? undefined);
  }

  console.info('[VisionExtract] Complete', { weeks: mergedWeeks.length, validated: validation.success });
  return { data, parseWarning, extractedMd: planMd };
}
```

- [ ] **Step 4: Add missing imports that `maybeRunVisionExtract` needs**

Verify the following are already imported in `src/lib/ai-plan-parser.ts`; add any that are missing:

```typescript
import { runParserV4 } from '@/lib/parsing/plan-parser-v4';
import { mergeWeeksFromPasses } from '@/lib/parsing/v4-pass-strategy';
import { ProgramJsonV1Schema, type ProgramJsonV1 } from '@/lib/schemas/program-json-v1';
import { createParseJob, saveParseArtifact, updateParseJobStatus } from '@/lib/parsing/parse-artifacts';
import { FLAGS } from '@/lib/feature-flags';
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. Fix any import path issues if they arise.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai-plan-parser.ts
git commit -m "feat: add maybeRunVisionExtract — PDF→MD→V4 pipeline behind PARSER_VISION_EXTRACT flag"
```

---

## Task 7: Admin Panel — Extracted MD Tab

**Files:**
- Modify: the admin parse-debug page (explore path before editing — see step 1)

- [ ] **Step 1: Find the admin parse-debug panel**

```bash
grep -r "parse-debug\|ParseArtifact\|parse_debug\|artifactType" src/app/admin --include="*.tsx" -l
```

Note the file paths returned. The main parse-debug page will show existing artifact display logic to follow.

- [ ] **Step 2: Locate where artifacts are fetched and rendered**

Read the file identified in step 1. Find:
- How `ParseArtifact` records are fetched (likely via `prisma.parseArtifact.findMany`)
- How existing artifact types (e.g. `V4_OUTPUT`) are displayed
- Whether there is a tab or accordion pattern for switching between artifact types

- [ ] **Step 3: Add Extracted MD tab**

Following the existing artifact display pattern, add a new tab or panel that:

1. Filters artifacts where `artifactType === 'EXTRACTED_MD'`
2. Extracts `artifact.json.md` (the stored Markdown string)
3. Renders it in a `<pre>` block with monospace font and horizontal scroll:

```tsx
{extractedMdArtifact && (
  <div>
    <h3>Extracted MD</h3>
    <pre style={{ fontFamily: 'monospace', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', background: '#0d1117', color: '#e0e0e0', padding: '16px', borderRadius: '8px' }}>
      {(extractedMdArtifact.json as { md: string }).md}
    </pre>
  </div>
)}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/
git commit -m "feat: add Extracted MD tab to admin parse-debug panel"
```

---

## Task 8: End-to-End Smoke Test

Verify the full pipeline works against a real PDF upload locally. This is a manual test.

- [ ] **Step 1: Set the flag in `.env.local`**

Add to `.env.local`:
```
PARSER_VISION_EXTRACT=true
ANTHROPIC_API_KEY=<your key>
PARSE_DUAL_WRITE=true
```

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 3: Upload a training plan PDF**

Use a PDF that has:
- A table-based schedule (week × day grid)
- At least one abbreviation code with a legend somewhere in the PDF
- Preferably a strength or supplementary section

Upload via the normal plan upload flow at `http://localhost:3001`.

- [ ] **Step 4: Verify in the admin panel**

Navigate to the admin parse-debug panel (`http://localhost:3001/admin/parse-debug` or similar).

Check:
- A `ParseJob` was created with `parserVersion = "vision-v1"`
- An `EXTRACTED_MD` artifact exists — the Extracted MD tab renders the structured Markdown
- A `V4_OUTPUT` artifact exists with the parsed `ProgramJsonV1`
- The plan was populated in the DB with activities (check the plan detail page)

- [ ] **Step 5: Spot-check quality**

Open the uploaded PDF side-by-side with the Extracted MD artifact. Verify:
- Abbreviations in the schedule are resolved inline (not just the raw code)
- Session structure (WU/intervals/CD) is expanded in the Session column
- Supplementary sections (strength, notes) are captured if present

- [ ] **Step 6: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit test results note (no code changes expected)**

```bash
git add .env.example  # if ANTHROPIC_API_KEY was not already there
git commit -m "feat: add ANTHROPIC_API_KEY to .env.example for vision pipeline"
```

---

## What to Do Next (Post-Stabilization)

Once `PARSER_VISION_EXTRACT` is stable in production, retire:
- `scripts/parse_plan_pdf.py`
- `src/lib/plan-parser-i18n.mjs`
- `src/lib/parsing/plan-parser-v5.ts`
- `src/lib/prompts/plan-parser/v5-survey-prompt.ts`
- `src/lib/parsing/v5-survey-schema.ts`
- `src/lib/parsing/ai-guide-extractor.ts`
