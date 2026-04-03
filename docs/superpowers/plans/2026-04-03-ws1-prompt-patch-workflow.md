# Prompt Patch Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dumb-append "Apply to Prompt" UI with an LLM-assisted diff/review flow where the local Qwen model suggests section-anchored insertions for both the vision and MD parser prompts, the admin reviews and approves/rejects each, then approved changes are saved as new named versions.

**Architecture:** A new `POST /api/admin/parser-rules/patch` route calls the local LLM with findings + prompt text and returns `PatchSuggestion[]` with section-level anchors. The vision prompt moves from a hardcoded `.ts` constant into the DB (with the `.ts` file kept as fallback). `ParserRulesClient.tsx` gets a new "Review Patch" panel replacing the current apply panel.

**Tech Stack:** Next.js API routes, Prisma, local llama-server (OpenAI-compat), React, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/seed-vision-prompt.mjs` | Create | One-shot script: insert VISION_EXTRACTION_PROMPT into DB as `vision_master` |
| `src/lib/prompts/plan-parser/vision-extraction-prompt.ts` | Modify | Add `VISION_PROMPT_NAME = 'vision_master'` export; keep constant as fallback |
| `src/lib/prompts/loader.ts` | Modify | Add `loadPromptFromDb(name)` that falls back to hardcoded constant |
| `src/lib/pdf/pdf-to-md.ts` | Modify | Use `loadPromptFromDb('vision_master')` instead of imported constant |
| `src/app/api/admin/parser-rules/patch/route.ts` | Create | POST handler: fetch prompts, call LLM, return PatchSuggestion[] |
| `src/app/admin/parser-rules/ParserRulesClient.tsx` | Modify | Replace "Apply to Prompt" panel with "Review Patch" panel |

---

## Task 1: Seed the vision prompt into the DB

**Files:**
- Create: `scripts/seed-vision-prompt.mjs`

- [ ] **Step 1: Create the seed script**

```js
#!/usr/bin/env node
/**
 * One-shot: inserts VISION_EXTRACTION_PROMPT into the ParserPrompt table
 * as 'vision_master'. Safe to run multiple times (upsert by name).
 *
 * Usage: node scripts/seed-vision-prompt.mjs
 *
 * Requires DATABASE_URL in environment (reads .env.local automatically).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* no .env.local */ }

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

// Import the prompt constant from the TS source via tsx
const { VISION_EXTRACTION_PROMPT } = await import(
  pathToFileURL(path.join(process.cwd(), 'src/lib/prompts/plan-parser/vision-extraction-prompt.ts')).href
);

await prisma.parserPrompt.upsert({
  where:  { name: 'vision_master' },
  create: { name: 'vision_master', text: VISION_EXTRACTION_PROMPT, isActive: true },
  update: { text: VISION_EXTRACTION_PROMPT }
});

console.log('vision_master seeded OK');
await prisma.$disconnect();
```

- [ ] **Step 2: Run the seed script**

```bash
npx tsx scripts/seed-vision-prompt.mjs
```

Expected output: `vision_master seeded OK`

Verify in DB:
```bash
npx prisma studio
# Check ParserPrompt table — should have 'vision_master' row with isActive: true
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-vision-prompt.mjs
git commit -m "feat: seed vision extraction prompt into DB as vision_master"
```

---

## Task 2: DB-backed prompt loader with fallback

**Files:**
- Modify: `src/lib/prompts/loader.ts`
- Modify: `src/lib/prompts/plan-parser/vision-extraction-prompt.ts`

- [ ] **Step 1: Export the prompt name constant from vision-extraction-prompt.ts**

In `src/lib/prompts/plan-parser/vision-extraction-prompt.ts`, add one line at the top:

```ts
export const VISION_PROMPT_DB_NAME = 'vision_master';
```

(Keep `VISION_EXTRACTION_PROMPT` constant unchanged — it becomes the DB fallback.)

- [ ] **Step 2: Add `loadPromptFromDb` to the loader**

Replace the contents of `src/lib/prompts/loader.ts` with:

```ts
import { readFile } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { VISION_EXTRACTION_PROMPT } from './plan-parser/vision-extraction-prompt';
import { MD_PARSER_PROMPT } from './plan-parser/md-parser-prompt';

/**
 * Load a prompt text file relative to src/lib/prompts/.
 * Example: loadPrompt('plan-parser/v4_master.txt')
 */
export async function loadPrompt(relativePath: string): Promise<string> {
  const absolute = path.join(process.cwd(), 'src', 'lib', 'prompts', relativePath);
  const content = await readFile(absolute, 'utf-8');
  return content.trim();
}

const FALLBACKS: Record<string, string> = {
  vision_master:    VISION_EXTRACTION_PROMPT,
  md_parser_master: MD_PARSER_PROMPT,
};

/**
 * Load the active version of a named prompt from the DB.
 * Falls back to the hardcoded constant if no DB record exists.
 */
export async function loadPromptFromDb(name: string): Promise<string> {
  const record = await prisma.parserPrompt.findFirst({
    where: { name, isActive: true },
    select: { text: true },
  });
  if (record) return record.text;
  const fallback = FALLBACKS[name];
  if (fallback) return fallback;
  throw new Error(`No prompt found for name "${name}" — seed it first.`);
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/loader.ts src/lib/prompts/plan-parser/vision-extraction-prompt.ts
git commit -m "feat: add loadPromptFromDb with fallback to hardcoded constants"
```

---

## Task 3: Wire pdf-to-md.ts to use DB-backed vision prompt

**Files:**
- Modify: `src/lib/pdf/pdf-to-md.ts`

- [ ] **Step 1: Find where VISION_EXTRACTION_PROMPT is used in pdf-to-md.ts**

```bash
grep -n "VISION_EXTRACTION_PROMPT\|vision" src/lib/pdf/pdf-to-md.ts
```

- [ ] **Step 2: Replace the hardcoded import with the DB loader**

Find the import line (something like):
```ts
import { VISION_EXTRACTION_PROMPT } from '@/lib/prompts/plan-parser/vision-extraction-prompt';
```

Replace it with:
```ts
import { loadPromptFromDb } from '@/lib/prompts/loader';
```

Then find where `VISION_EXTRACTION_PROMPT` is used as a string argument and replace with:
```ts
const visionPrompt = await loadPromptFromDb('vision_master');
// use visionPrompt where VISION_EXTRACTION_PROMPT was used
```

(The function calling it will need to be async if it isn't already — check the call site.)

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/pdf/pdf-to-md.ts
git commit -m "feat: load vision prompt from DB in pdf-to-md pipeline"
```

---

## Task 4: Patch API route

**Files:**
- Create: `src/app/api/admin/parser-rules/patch/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest } from 'next/server';
import { requireAdminAccess } from '@/lib/admin';
import { redirect } from 'next/navigation';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { loadPromptFromDb } from '@/lib/prompts/loader';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OUT_DIR = path.join(process.cwd(), 'scripts', 'parser-analysis');

export interface PatchSuggestion {
  prompt_target: 'vision' | 'md_parser';
  after_section: string;
  insert_text: string;
  rationale: string;
  source_issue: string;
  approved: boolean;
}

const PATCH_SYSTEM = `You are a prompt engineer helping improve an AI training plan parser.
You will be given:
1. Findings from analysing multiple training plan PDFs (patterns the parser currently misses)
2. A parser prompt text

Your job: suggest where in the prompt each finding should be addressed.

The prompt is divided into sections separated by headings (lines in ALL CAPS, or lines starting with ##, STEP, RULES, ABBREVIATIONS, etc.).

Respond ONLY with a JSON array. No markdown. No text outside JSON.`;

function patchUserPrompt(promptName: string, promptText: string, findings: unknown): string {
  return `PROMPT NAME: ${promptName}

PROMPT TEXT:
${promptText}

FINDINGS FROM PDF ANALYSIS:
${JSON.stringify(findings, null, 2)}

Return a JSON array of patch suggestions. Each element must have this EXACT shape:
{
  "prompt_target": "${promptName === 'vision_master' ? 'vision' : 'md_parser'}",
  "after_section": "<exact section heading from the prompt where this should be inserted — copy verbatim>",
  "insert_text": "<the exact text to insert after that section heading>",
  "rationale": "<one sentence: why this rule belongs in that section>",
  "source_issue": "<the issue title from the findings this addresses>"
}

Rules:
- Only suggest insertions for findings that are NOT already handled by the prompt.
- after_section must be a heading that actually exists verbatim in the prompt text.
- If a finding applies to both prompts, include it for both.
- If no good insertion point exists for a finding, omit it — do not force it.
- Return [] if no suggestions apply.`;
}

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) redirect('/sign-in');

  const body = await req.json() as {
    server?: string;
    model?: string;
    prompt_targets?: Array<'vision' | 'md_parser' | 'both'>;
  };

  const server = (body.server ?? 'http://localhost:8080').replace(/\/$/, '');
  const model  = body.model ?? 'local';
  const targets = body.prompt_targets?.includes('both')
    ? ['vision', 'md_parser'] as const
    : (body.prompt_targets ?? ['vision', 'md_parser']) as Array<'vision' | 'md_parser'>;

  // Load findings
  const aggregatePath = path.join(OUT_DIR, 'aggregate.json');
  if (!existsSync(aggregatePath)) {
    return Response.json({ error: 'No aggregate.json found — run analysis first.' }, { status: 400 });
  }
  const findings = JSON.parse(readFileSync(aggregatePath, 'utf8'));

  // Health check
  try {
    const h = await fetch(`${server}/health`);
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
  } catch (err) {
    return Response.json(
      { error: `Cannot reach LLM server at ${server}: ${(err as Error).message}` },
      { status: 503 }
    );
  }

  const promptNameMap = {
    vision:    'vision_master',
    md_parser: 'md_parser_master',
  };

  const allSuggestions: PatchSuggestion[] = [];

  for (const target of targets) {
    const dbName = promptNameMap[target];
    let promptText: string;
    try {
      promptText = await loadPromptFromDb(dbName);
    } catch {
      continue; // skip if prompt not seeded yet
    }

    const userContent = patchUserPrompt(dbName, promptText, findings);

    const res = await fetch(`${server}/v1/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PATCH_SYSTEM },
          { role: 'user',   content: userContent  },
        ],
        temperature:     0.1,
        max_tokens:      4096,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return Response.json({ error: `LLM error: ${txt.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '[]';

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    // Handle both {suggestions:[...]} and [...] shapes from LLM
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { suggestions?: unknown[] }).suggestions)
        ? (parsed as { suggestions: unknown[] }).suggestions
        : [];

    for (const s of arr) {
      if (
        typeof s === 'object' && s !== null &&
        'after_section' in s && 'insert_text' in s
      ) {
        allSuggestions.push({ ...(s as PatchSuggestion), approved: true });
      }
    }
  }

  return Response.json({ suggestions: allSuggestions });
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/parser-rules/patch/route.ts
git commit -m "feat: add POST /api/admin/parser-rules/patch — LLM-assisted prompt diff"
```

---

## Task 5: Replace apply panel with Review Patch UI in ParserRulesClient

**Files:**
- Modify: `src/app/admin/parser-rules/ParserRulesClient.tsx`

- [ ] **Step 1: Add PatchSuggestion import and new state**

At the top of `ParserRulesClient.tsx`, add the type import:

```ts
import type { PatchSuggestion } from '@/app/api/admin/parser-rules/patch/route';
```

Replace all existing `applyOpen / applyLoading / applyAdditions / applyNewName / applyActivate / applyStatus / activePrompt` state declarations with:

```ts
// Patch review state
const [patchLoading,     setPatchLoading]     = useState(false);
const [patchSuggestions, setPatchSuggestions] = useState<PatchSuggestion[]>([]);
const [patchStatus,      setPatchStatus]      = useState<{ ok: boolean; message: string } | null>(null);
const [patchSaving,      setPatchSaving]      = useState(false);
const [patchNewName,     setPatchNewName]      = useState('');
const [patchActivate,    setPatchActivate]    = useState(false);
```

- [ ] **Step 2: Add fetchPatch handler**

After the existing `useCallback` definitions, add:

```ts
const fetchPatch = useCallback(async () => {
  setPatchLoading(true);
  setPatchStatus(null);
  setPatchSuggestions([]);
  try {
    const res = await fetch('/api/admin/parser-rules/patch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ server, model, prompt_targets: ['both'] }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? `Error ${res.status}`);
    }
    const data = await res.json() as { suggestions: PatchSuggestion[] };
    setPatchSuggestions(data.suggestions.map(s => ({ ...s, approved: true })));
    if (data.suggestions.length === 0) {
      setPatchStatus({ ok: true, message: 'No new suggestions — prompt may already be up to date.' });
    }
  } catch (err) {
    setPatchStatus({ ok: false, message: (err as Error).message });
  } finally {
    setPatchLoading(false);
  }
}, [server, model]);

const toggleApproval = useCallback((idx: number) => {
  setPatchSuggestions(prev =>
    prev.map((s, i) => i === idx ? { ...s, approved: !s.approved } : s)
  );
}, []);

const savePatch = useCallback(async () => {
  if (!patchNewName) return;
  const approved = patchSuggestions.filter(s => s.approved);
  if (approved.length === 0) {
    setPatchStatus({ ok: false, message: 'No suggestions approved.' });
    return;
  }

  setPatchSaving(true);
  setPatchStatus(null);

  // Group by target
  const byTarget = new Map<string, PatchSuggestion[]>();
  for (const s of approved) {
    const key = s.prompt_target;
    byTarget.set(key, [...(byTarget.get(key) ?? []), s]);
  }

  try {
    for (const [target, suggestions] of byTarget.entries()) {
      const dbName = target === 'vision' ? 'vision_master' : 'md_parser_master';

      // Fetch current active prompt text
      const promptRes = await fetch('/api/admin/parser-prompts/active');
      // Note: active endpoint only returns the md_parser prompt.
      // For vision we need to fetch by name — use the list endpoint.
      const allRes = await fetch('/api/admin/parser-prompts');
      const allPrompts = await allRes.json() as Array<{ id: string; name: string; text: string }>;
      const current = allPrompts.find(p => p.name === dbName);
      if (!current) {
        setPatchStatus({ ok: false, message: `Prompt "${dbName}" not found in DB. Seed it first.` });
        setPatchSaving(false);
        return;
      }

      // Apply insertions: find each section heading and insert after it
      let text = current.text;
      for (const s of suggestions) {
        const heading = s.after_section;
        const idx = text.indexOf(heading);
        if (idx === -1) {
          // fallback: append at end with a comment
          text += `\n\n// Auto-patched (section "${heading}" not found):\n${s.insert_text}`;
        } else {
          // insert after the heading line
          const lineEnd = text.indexOf('\n', idx);
          const insertAt = lineEnd === -1 ? text.length : lineEnd + 1;
          text = text.slice(0, insertAt) + s.insert_text + '\n' + text.slice(insertAt);
        }
      }

      // Save as new version
      const newName = `${dbName}_patched_${new Date().toISOString().slice(0, 10)}`;
      await fetch('/api/admin/parser-prompts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newName, text, activate: patchActivate }),
      });
    }

    setPatchStatus({
      ok: true,
      message: patchActivate
        ? `Saved and activated patched prompt(s).`
        : `Saved as new version(s). Activate in Prompt Manager.`,
    });
    setPatchSuggestions([]);
  } catch (err) {
    setPatchStatus({ ok: false, message: (err as Error).message });
  } finally {
    setPatchSaving(false);
  }
}, [patchSuggestions, patchNewName, patchActivate]);
```

- [ ] **Step 3: Replace the apply panel JSX**

Find the JSX block that starts with `{/* Apply to Prompt */}` or the block containing `applyOpen` and replace it entirely with:

```tsx
{/* ── Review Patch ─────────────────────────────────────────────── */}
<div className="admin-card" style={{ marginTop: 24 }}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a2a44' }}>Smart Patch</div>
      <div style={{ fontSize: 12, color: '#65728a', marginTop: 2 }}>
        Ask the local LLM to suggest section-anchored insertions for the parser prompts.
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
      {patchStatus && (
        <span style={{ fontSize: 12, fontWeight: 600, color: patchStatus.ok ? '#0f8a47' : '#b42318' }}>
          {patchStatus.message}
        </span>
      )}
      {!aggregate && (
        <span style={{ fontSize: 12, color: '#65728a' }}>Run analysis first.</span>
      )}
      {aggregate && (
        <button
          onClick={fetchPatch}
          disabled={patchLoading}
          style={patchLoading ? { ...runBtnStyle, opacity: 0.5, cursor: 'not-allowed' } : runBtnStyle}
        >
          {patchLoading ? 'Asking LLM…' : 'Generate patch'}
        </button>
      )}
    </div>
  </div>

  {patchSuggestions.length > 0 && (
    <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
      {patchSuggestions.map((s, idx) => (
        <div
          key={idx}
          style={{
            border: `1px solid ${s.approved ? '#0f8a47' : '#d0d5de'}`,
            borderRadius: 8,
            padding: 12,
            background: s.approved ? 'rgba(15,138,71,0.04)' : '#fafafa',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a2a44', marginBottom: 2 }}>
                <span style={{
                  background: s.prompt_target === 'vision' ? '#e8f0ff' : '#fff3e0',
                  color: s.prompt_target === 'vision' ? '#1a3a8f' : '#b45309',
                  borderRadius: 4, padding: '1px 6px', fontSize: 11, marginRight: 6
                }}>
                  {s.prompt_target === 'vision' ? 'vision' : 'md_parser'}
                </span>
                after: "{s.after_section}"
              </div>
              <pre style={{
                background: '#f0f9f4', border: '1px solid #c3e6d0', borderRadius: 4,
                padding: '6px 8px', fontSize: 12, margin: '6px 0',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: '#0f8a47'
              }}>
                + {s.insert_text}
              </pre>
              <div style={{ fontSize: 11, color: '#65728a' }}>
                <strong>Why:</strong> {s.rationale}
              </div>
              <div style={{ fontSize: 11, color: '#8a9ab5', marginTop: 2 }}>
                Addresses: {s.source_issue}
              </div>
            </div>
            <button
              onClick={() => toggleApproval(idx)}
              style={{
                flexShrink: 0,
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${s.approved ? '#0f8a47' : '#d0d5de'}`,
                background: s.approved ? '#0f8a47' : '#fff',
                color: s.approved ? '#fff' : '#65728a',
                fontSize: 12, fontWeight: 600, cursor: 'pointer'
              }}
            >
              {s.approved ? 'Approved' : 'Rejected'}
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
        <input
          type="text"
          placeholder="New version name (e.g. v4_master_patched)"
          value={patchNewName}
          onChange={e => setPatchNewName(e.target.value)}
          style={{ flex: 1, padding: '6px 10px', border: '1px solid #d0d5de', borderRadius: 6, fontSize: 13 }}
        />
        <label style={{ fontSize: 12, color: '#1a2a44', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={patchActivate} onChange={e => setPatchActivate(e.target.checked)} />
          Activate immediately
        </label>
        <button
          onClick={savePatch}
          disabled={patchSaving || !patchNewName}
          style={patchSaving || !patchNewName
            ? { ...runBtnStyle, opacity: 0.5, cursor: 'not-allowed' }
            : runBtnStyle}
        >
          {patchSaving ? 'Saving…' : `Save ${patchSuggestions.filter(s => s.approved).length} approved`}
        </button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 4: Remove now-unused state and handlers**

Search for and delete these now-unused items:
- `applyOpen`, `applyLoading`, `applyAdditions`, `applyNewName`, `applyActivate`, `applyStatus`, `activePrompt` state declarations
- `buildAdditions` function
- `prepareApply` callback
- `saveNewVersion` callback
- Any JSX referencing `applyOpen`

- [ ] **Step 5: Verify typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors

- [ ] **Step 6: Manual smoke test**

1. Start dev server: `npm run dev`
2. Navigate to `http://localhost:3001/admin/parser-rules`
3. Confirm "Smart Patch" panel is visible
4. With local llama-server running: click "Generate patch", verify suggestion cards appear
5. Toggle approve/reject on a card, verify border color changes
6. Enter a version name, save — verify no console errors

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/parser-rules/ParserRulesClient.tsx
git commit -m "feat: replace apply panel with LLM-assisted smart patch review UI"
```

---

## Self-Review Checklist

- [x] Spec: DB migration of vision prompt → Task 1
- [x] Spec: Prompt loader falls back to .ts constant → Task 2
- [x] Spec: pdf-to-md uses DB prompt → Task 3
- [x] Spec: POST /api/admin/parser-rules/patch → Task 4
- [x] Spec: Review UI with approve/reject per suggestion → Task 5
- [x] Spec: Save as new named version → Task 5 savePatch
- [x] Spec: md_parser_master name used — note: existing prompts in DB may use a different name. Before running, verify the active prompt name with `npx prisma studio` and update `promptNameMap` in the route if needed.
- [x] No placeholders
- [x] Type names consistent: `PatchSuggestion` used in route, imported in client
