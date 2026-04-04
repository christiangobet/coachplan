import { NextRequest } from 'next/server';
import { requireAdminAccess } from '@/lib/admin';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { extractPdfText } from '@/lib/pdf/extract-text';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ROOT       = process.cwd();
const PLANS_DIR  = path.join(ROOT, 'scripts', 'fixtures', 'plans');
const OUT_DIR    = path.join(ROOT, 'scripts', 'parser-analysis');

// ── Known-rules preamble injected into every analysis prompt ──────────────────
const KNOWN_RULES = `Rules the parser ALREADY handles (do not flag these):
- Abbreviations: WU=warm-up, CD=cool-down, LR=long run, LRL=long run with laps, E=easy, XT/XTR=cross-training, STR=strength, RST=rest, MOB=mobility, YOG=yoga, HIK=hike, RP=race pace, MP=marathon pace, NS=negative splits
- Symbols: ★=priority/must-do, ♥=optional/bail-allowed
- Distance ranges: upper bound (e.g. "4-5 miles" → 5)
- Duration ranges: upper bound, both bounds stored
- H.MM duration format: 1.05=65 min, 2.20=140 min
- Multi-session cells split by "+"
- "or" clauses treated as optional alternatives
- Languages: English, German, French (common day/week/unit terms)`;

const ANALYSIS_SYSTEM = `You are a training plan parsing expert helping improve an automated PDF parser.

The parser converts endurance training plan PDFs to structured JSON. Schema summary:
- program: { title, distance_target (5K/10K/HALF/MARATHON/ULTRA), plan_length_weeks, layout_type (calendar_grid/sequential_table/symbolic/frequency_based), source_units (km/miles/mixed) }
- weeks[]: { week_number, week_type (normal/cutback/taper/race), sessions[] }
- sessions[]: { day_of_week (Mon-Sun or null), activity_type (Run/Walk/CrossTraining/Strength/Rest/Race/Mobility/Yoga/Hike/Other), session_role, distance_miles, distance_km, duration_minutes, intensity, steps[], raw_text }

${KNOWN_RULES}

Respond ONLY with a JSON object. No markdown. No text outside JSON.`;

function analysisUserPrompt(filename: string, text: string): string {
  return `Analyze this training plan PDF text and identify parsing challenges.

Filename: ${filename}

Raw extracted text (first 6000 chars):
${text.slice(0, 6000)}

Return a JSON object with this EXACT structure (all fields required):
{
  "layout_type": "calendar_grid|sequential_table|symbolic|frequency_based|unclear",
  "source_units": "km|miles|mixed|unclear",
  "total_weeks_detected": <integer or null>,
  "sessions_sample": [
    {
      "raw": "<exact text snippet from PDF>",
      "day": "<Mon/Tue/Wed/Thu/Fri/Sat/Sun or null>",
      "type": "<Run/Rest/CrossTraining/etc>",
      "distance": "<distance string if present, else null>",
      "parsing_note": "<specific challenge parsing this session, or null if straightforward>"
    }
  ],
  "unhandled_patterns": [
    {
      "pattern": "<exact text example from the PDF>",
      "issue": "<why the existing rules would get this wrong>",
      "suggested_rule": "<plain-English rule to add to the parser prompt>"
    }
  ],
  "new_abbreviations": [
    {
      "abbr": "<symbol or abbreviation>",
      "meaning": "<what it means in context>",
      "example": "<sentence from PDF where it appears>"
    }
  ],
  "prompt_improvements": [
    "<specific, actionable rule exactly as it would appear in the parser prompt>"
  ],
  "anomalies": ["<anything unusual about this plan format that a parser might stumble on>"]
}

sessions_sample: include 3-5 sessions, prioritising ones with non-obvious formatting.
unhandled_patterns: only flag patterns NOT in the known-rules list above.
prompt_improvements: write them ready to paste — be precise, not vague.`;
}

const AGGREGATE_SYSTEM = `You are helping improve an AI training plan parser prompt.
You have per-plan analysis findings from multiple training plan PDFs.
Synthesize them into ranked, actionable prompt improvements.
Respond ONLY with a JSON object. No markdown.`;

function aggregateUserPrompt(findings: FindingEntry[]): string {
  const slim = findings.map(f => ({
    file:                f.file,
    layout_type:         f.analysis.layout_type,
    unhandled_patterns:  f.analysis.unhandled_patterns,
    new_abbreviations:   f.analysis.new_abbreviations,
    prompt_improvements: f.analysis.prompt_improvements,
    anomalies:           f.analysis.anomalies,
  }));

  return `Here are parser analysis findings from ${findings.length} training plan PDFs:

${JSON.stringify(slim, null, 2)}

Synthesize into a JSON object with this EXACT structure:
{
  "top_issues": [
    {
      "rank": 1,
      "issue": "<concise issue name>",
      "frequency": <number of plans where this appeared>,
      "examples": ["<raw text example 1>", "<raw text example 2>"],
      "recommended_rule": "<exact text to paste into the parser prompt>"
    }
  ],
  "new_abbreviations_to_add": [
    {
      "abbr": "<abbreviation>",
      "meaning": "<meaning>",
      "seen_in": ["<file1>", "<file2>"]
    }
  ],
  "prompt_sections_to_update": [
    {
      "section": "<STEP N name or section heading in the prompt>",
      "current_gap": "<what the current rules miss>",
      "addition": "<exact text to add to that section>"
    }
  ],
  "summary": "<2-3 sentence plain-English summary of the most impactful improvements to make>"
}

Rank top_issues by frequency (most common first), then impact.
Merge duplicate/similar issues from different plans into one entry.`;
}

// ── LLM call ──────────────────────────────────────────────────────────────────
async function callLlm(
  server: string,
  model: string,
  system: string,
  user: string
): Promise<string> {
  const res = await fetch(`${server}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      temperature:     0.1,
      max_tokens:      4096,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LLM ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

// ── JSON extraction + repair helpers ─────────────────────────────────────────
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = raw.search(/[\[{]/);
  if (start !== -1) return raw.slice(start);
  return raw;
}

// Fix common LLM JSON issues before parsing:
// - Single-line // comments
// - Multi-line /* */ comments
// - Trailing commas before } or ]
// - Unescaped literal newlines inside string values
function repairJson(s: string): string {
  // Remove // comments (not inside strings — approximate but covers most cases)
  s = s.replace(/\/\/[^\n"]*/g, '');
  // Remove /* */ comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // Replace unescaped literal newlines/tabs inside quoted strings
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner: string) => {
    const fixed = inner
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${fixed}"`;
  });
  return s;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlanAnalysis {
  layout_type:         string;
  source_units:        string;
  total_weeks_detected: number | null;
  sessions_sample:     unknown[];
  unhandled_patterns:  Array<{ pattern: string; issue: string; suggested_rule: string }>;
  new_abbreviations:   Array<{ abbr: string; meaning: string; example: string }>;
  prompt_improvements: string[];
  anomalies:           string[];
}

interface FindingEntry {
  file:       string;
  text_chars: number;
  analysis:   PlanAnalysis;
}

// ── GET — return existing results ─────────────────────────────────────────────
export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  const files = existsSync(PLANS_DIR)
    ? readdirSync(PLANS_DIR).filter(f => f.toLowerCase().endsWith('.pdf'))
    : [];

  const aggregatePath = path.join(OUT_DIR, 'aggregate.json');
  const aggregate = existsSync(aggregatePath)
    ? JSON.parse(readFileSync(aggregatePath, 'utf8'))
    : null;

  const perPlan: Record<string, unknown> = {};
  if (existsSync(OUT_DIR)) {
    for (const f of readdirSync(OUT_DIR).filter(f => f.endsWith('.json') && f !== 'aggregate.json')) {
      try {
        perPlan[f.replace('.json', '.pdf')] = JSON.parse(
          readFileSync(path.join(OUT_DIR, f), 'utf8')
        );
      } catch { /* skip malformed */ }
    }
  }

  return Response.json({ files, aggregate, perPlan });
}

// ── POST — run analysis (streaming NDJSON) ────────────────────────────────────
export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return new Response('Unauthorized', { status: 401 });

  const body = await req.json() as { server?: string; model?: string; limit?: number; files?: string[] };
  const server = (body.server ?? 'http://localhost:8080').replace(/\/$/, '');
  const model  = body.model  ?? 'local';
  const limit  = body.limit  ?? 999;

  // Which PDFs to process
  const allFiles = existsSync(PLANS_DIR)
    ? readdirSync(PLANS_DIR).filter(f => f.toLowerCase().endsWith('.pdf'))
    : [];
  const selected = body.files?.length
    ? allFiles.filter(f => body.files!.includes(f))
    : allFiles;
  const files = selected.slice(0, limit);

  mkdirSync(OUT_DIR, { recursive: true });

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      function emit(obj: unknown) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      }

      try {
        // Health check
        emit({ type: 'log', message: `Checking ${server}...` });
        try {
          const h = await fetch(`${server}/health`);
          if (!h.ok) throw new Error(`HTTP ${h.status}`);
          emit({ type: 'log', message: 'Server OK' });
        } catch (err) {
          emit({ type: 'error', message: `Cannot reach LLM server at ${server}: ${(err as Error).message}` });
          controller.close();
          return;
        }

        if (files.length === 0) {
          emit({ type: 'error', message: `No PDFs found in ${PLANS_DIR}` });
          controller.close();
          return;
        }

        emit({ type: 'start', total: files.length });

        const findings: FindingEntry[] = [];

        for (let i = 0; i < files.length; i++) {
          const file     = files[i];
          const filePath = path.join(PLANS_DIR, file);

          // Extract
          emit({ type: 'progress', file, step: 'extract', index: i, total: files.length });
          let text: string;
          try {
            const buf = readFileSync(filePath);
            const result = await extractPdfText(buf);
            text = result.fullText;
            emit({ type: 'progress', file, step: 'extract_ok', chars: text.length });
          } catch (err) {
            emit({ type: 'plan_error', file, step: 'extract', message: (err as Error).message });
            continue;
          }

          // Analyse
          emit({ type: 'progress', file, step: 'analyze' });
          let analysis: PlanAnalysis;
          try {
            const raw = await callLlm(server, model, ANALYSIS_SYSTEM, analysisUserPrompt(file, text));
            const cleaned = repairJson(extractJson(raw));
            analysis  = JSON.parse(cleaned) as PlanAnalysis;
            emit({
              type:     'progress',
              file,
              step:     'analyze_ok',
              patterns: analysis.unhandled_patterns?.length ?? 0,
              abbrs:    analysis.new_abbreviations?.length  ?? 0,
            });
          } catch (err) {
            emit({ type: 'plan_error', file, step: 'analyze', message: (err as Error).message });
            continue;
          }

          const entry: FindingEntry = { file, text_chars: text.length, analysis };
          findings.push(entry);

          // Save per-plan JSON
          try {
            writeFileSync(
              path.join(OUT_DIR, file.replace(/\.pdf$/i, '.json')),
              JSON.stringify(entry, null, 2)
            );
          } catch { /* non-fatal */ }

          emit({ type: 'plan_done', file, analysis });
        }

        if (findings.length === 0) {
          emit({ type: 'error', message: 'No plans analysed successfully.' });
          controller.close();
          return;
        }

        // Aggregate
        emit({ type: 'log', message: `Aggregating ${findings.length} finding(s)...` });
        let aggregate: unknown;
        try {
          const raw  = await callLlm(server, model, AGGREGATE_SYSTEM, aggregateUserPrompt(findings));
          aggregate  = JSON.parse(repairJson(extractJson(raw)));
          writeFileSync(path.join(OUT_DIR, 'aggregate.json'), JSON.stringify(aggregate, null, 2));
        } catch (err) {
          emit({ type: 'log', message: `Aggregation failed: ${(err as Error).message}` });
          aggregate = null;
        }

        emit({ type: 'complete', aggregate, count: findings.length });
      } catch (err) {
        emit({ type: 'error', message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
