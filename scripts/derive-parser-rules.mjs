#!/usr/bin/env node
/**
 * derive-parser-rules.mjs
 *
 * Batch-analyzes training plan PDFs with a local LLM to surface patterns
 * the V4 parser misses and suggest concrete prompt improvements.
 *
 * Prerequisites:
 *   A local llama-server (or any OpenAI-compatible endpoint) running.
 *   Recommended: llama-server -hf ggml-org/Qwen2.5-7B-Instruct-GGUF --port 8080
 *
 * Usage:
 *   node scripts/derive-parser-rules.mjs [options]
 *
 * Options:
 *   --server <url>   LLM server base URL  [http://localhost:8080]
 *   --model  <name>  Model name to send   [local]
 *   --plans  <dir>   Directory of PDFs    [scripts/fixtures/plans]
 *   --out    <dir>   Output directory     [scripts/parser-analysis]
 *   --limit  <n>     Max plans to process [all]
 *   --verbose        Print raw LLM output
 *
 * Outputs (in --out):
 *   FINDINGS.md       Human-readable summary — read this first
 *   aggregate.json    Full aggregated JSON
 *   <plan>.json       Per-plan analysis
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.join(__dirname, '..');

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return (i !== -1 && args[i + 1]) ? args[i + 1] : fallback;
}
const SERVER    = getArg('server', 'http://localhost:8080');
const MODEL     = getArg('model',  'local');
const PLANS_DIR = path.resolve(getArg('plans', path.join(__dirname, 'fixtures', 'plans')));
const OUT_DIR   = path.resolve(getArg('out',   path.join(__dirname, 'parser-analysis')));
const LIMIT     = parseInt(getArg('limit', '999'), 10);
const VERBOSE   = args.includes('--verbose');

mkdirSync(OUT_DIR, { recursive: true });

// ── PDF text extraction (mirrors src/lib/pdf/extract-text.ts) ─────────────────
async function extractPdfText(filePath) {
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Handle both namespace and default exports
  const pdfjs = mod.default ?? mod;

  const workerPath = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const buffer = readFileSync(filePath);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str ?? '').join(' ').trim());
  }
  return pages.join('\n\n');
}

// ── Local LLM call ─────────────────────────────────────────────────────────────
async function callLLM(systemPrompt, userContent, expectJson = false) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  }
    ],
    temperature: 0.1,
    max_tokens: 4096,
  };
  if (expectJson) body.response_format = { type: 'json_object' };

  const res = await fetch(`${SERVER}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM server error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  if (VERBOSE) console.log('\n── LLM ──\n', content, '\n────────\n');
  return content;
}

// ── Per-plan analysis ──────────────────────────────────────────────────────────
const ANALYSIS_SYSTEM = `You are a training plan parsing expert helping improve an automated PDF parser.

The parser converts endurance training plan PDFs to structured JSON. Schema summary:
- program: { title, distance_target (5K/10K/HALF/MARATHON/ULTRA), plan_length_weeks, layout_type (calendar_grid/sequential_table/symbolic/frequency_based), source_units (km/miles/mixed) }
- weeks[]: { week_number, week_type (normal/cutback/taper/race), sessions[] }
- sessions[]: { day_of_week (Mon-Sun or null), activity_type (Run/Walk/CrossTraining/Strength/Rest/Race/Mobility/Yoga/Hike/Other), session_role, distance_miles, distance_km, duration_minutes, intensity, steps[], raw_text }

Rules the parser ALREADY handles (do not flag these):
- Abbreviations: WU=warm-up, CD=cool-down, LR=long run, LRL=long run with laps, E=easy, XT/XTR=cross-training, STR=strength, RST=rest, MOB=mobility, YOG=yoga, HIK=hike, RP=race pace, MP=marathon pace, NS=negative splits
- Symbols: ★=priority/must-do, ♥=optional/bail-allowed
- Distance ranges: upper bound (e.g. "4-5 miles" → 5)
- Duration ranges: upper bound, both bounds stored
- H.MM duration format: 1.05=65 min, 2.20=140 min
- Multi-session cells split by "+"
- "or" clauses treated as optional alternatives
- Languages: English, German, French (common day/week/unit terms)

Respond ONLY with a JSON object. No markdown. No text outside JSON.`;

function analysisUserPrompt(filename, text) {
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
  "anomalies": ["<anything unusual about this plan's format that a parser might stumble on>"]
}

sessions_sample: include 3-5 sessions, prioritizing ones with non-obvious formatting.
unhandled_patterns: only flag patterns NOT in the known-rules list above.
prompt_improvements: write them ready to paste — be precise, not vague.`;
}

// ── Aggregation ────────────────────────────────────────────────────────────────
const AGGREGATE_SYSTEM = `You are helping improve an AI training plan parser prompt.
You have per-plan analysis findings from multiple training plan PDFs.
Synthesize them into ranked, actionable prompt improvements.
Respond ONLY with a JSON object. No markdown.`;

function aggregateUserPrompt(findings) {
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

// ── Markdown renderer ──────────────────────────────────────────────────────────
function renderMarkdown(aggregate, perPlanLog, processedAt) {
  const lines = [];

  lines.push('# Parser Rule Findings');
  lines.push('');
  lines.push(`Generated: ${processedAt}`);
  lines.push(`Plans: ${perPlanLog.length}  |  Successful: ${perPlanLog.filter(p => p.ok).length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (aggregate.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(aggregate.summary);
    lines.push('');
  }

  lines.push('## Plans processed');
  lines.push('');
  lines.push('| File | Status | Layout | Patterns found |');
  lines.push('|------|--------|--------|---------------|');
  for (const p of perPlanLog) {
    if (p.error) {
      lines.push(`| ${p.file} | ❌ ${p.error} | — | — |`);
    } else {
      lines.push(`| ${p.file} | ✓ | ${p.layout_type ?? '?'} | ${p.patterns} |`);
    }
  }
  lines.push('');

  if (aggregate.top_issues?.length) {
    lines.push('## Top issues (ranked by frequency)');
    lines.push('');
    for (const issue of aggregate.top_issues) {
      lines.push(`### ${issue.rank}. ${issue.issue}`);
      lines.push('');
      lines.push(`Appears in **${issue.frequency}** plan(s).`);
      lines.push('');
      if (issue.examples?.length) {
        lines.push('**Examples from PDFs:**');
        for (const ex of issue.examples) lines.push(`- \`${ex}\``);
        lines.push('');
      }
      if (issue.recommended_rule) {
        lines.push('**Rule to add to the prompt:**');
        lines.push('');
        lines.push('```');
        lines.push(issue.recommended_rule);
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (aggregate.new_abbreviations_to_add?.length) {
    lines.push('## New abbreviations to add');
    lines.push('');
    lines.push('Add to the abbreviations list in the parser prompt:');
    lines.push('');
    lines.push('| Abbreviation | Meaning | Seen in |');
    lines.push('|-------------|---------|---------|');
    for (const a of aggregate.new_abbreviations_to_add) {
      const seen = (a.seen_in ?? []).join(', ');
      lines.push(`| \`${a.abbr}\` | ${a.meaning} | ${seen} |`);
    }
    lines.push('');
  }

  if (aggregate.prompt_sections_to_update?.length) {
    lines.push('## Prompt section updates');
    lines.push('');
    for (const s of aggregate.prompt_sections_to_update) {
      lines.push(`### ${s.section}`);
      lines.push('');
      lines.push(`**Gap:** ${s.current_gap}`);
      lines.push('');
      lines.push('**Add:**');
      lines.push('');
      lines.push('```');
      lines.push(s.addition);
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('*To re-run: `node scripts/derive-parser-rules.mjs --plans <dir> --out scripts/parser-analysis`*');

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Server : ${SERVER}`);
  console.log(`Plans  : ${PLANS_DIR}`);
  console.log(`Output : ${OUT_DIR}`);
  console.log('');

  // Health check
  process.stdout.write('Checking LLM server... ');
  try {
    const res = await fetch(`${SERVER}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('OK');
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    console.error('');
    console.error('Start the server first:');
    console.error('  llama-server -hf ggml-org/Qwen2.5-7B-Instruct-GGUF --port 8080');
    console.error('');
    console.error('Or point at a different server:');
    console.error('  node scripts/derive-parser-rules.mjs --server http://localhost:11434');
    process.exit(1);
  }

  // Discover PDFs
  let files;
  try {
    files = readdirSync(PLANS_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).slice(0, LIMIT);
  } catch (err) {
    console.error(`Cannot read plans directory ${PLANS_DIR}: ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`No PDFs found in ${PLANS_DIR}`);
    console.error('Add PDF files or use --plans to point at another directory');
    process.exit(1);
  }

  console.log(`Found ${files.length} PDF(s)\n`);

  const findings    = [];
  const perPlanLog  = [];

  for (let i = 0; i < files.length; i++) {
    const file     = files[i];
    const filePath = path.join(PLANS_DIR, file);
    const prefix   = `[${i + 1}/${files.length}] ${file}`;

    // Extract text
    process.stdout.write(`${prefix} — extracting... `);
    let text;
    try {
      text = await extractPdfText(filePath);
      console.log(`${text.length} chars`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      perPlanLog.push({ file, ok: false, error: `extract: ${err.message}` });
      continue;
    }

    // LLM analysis
    process.stdout.write(`${prefix} — analyzing... `);
    let analysis;
    try {
      const raw = await callLLM(ANALYSIS_SYSTEM, analysisUserPrompt(file, text), true);
      analysis  = JSON.parse(raw);
      const np  = analysis.unhandled_patterns?.length ?? 0;
      const na  = analysis.new_abbreviations?.length  ?? 0;
      console.log(`${np} pattern(s), ${na} abbreviation(s)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      perPlanLog.push({ file, ok: false, error: `llm: ${err.message}` });
      continue;
    }

    findings.push({ file, text_chars: text.length, analysis });
    perPlanLog.push({
      file,
      ok:          true,
      layout_type: analysis.layout_type,
      patterns:    analysis.unhandled_patterns?.length ?? 0,
    });

    // Save per-plan JSON
    const planOut = path.join(OUT_DIR, file.replace(/\.pdf$/i, '.json'));
    writeFileSync(planOut, JSON.stringify({ file, text_chars: text.length, analysis }, null, 2));
  }

  if (findings.length === 0) {
    console.error('\nNo plans analyzed successfully.');
    process.exit(1);
  }

  // Aggregate
  console.log(`\nAggregating ${findings.length} finding(s)...`);
  let aggregate;
  try {
    const raw  = await callLLM(AGGREGATE_SYSTEM, aggregateUserPrompt(findings), true);
    aggregate  = JSON.parse(raw);
  } catch (err) {
    console.error(`Aggregation failed: ${err.message}`);
    aggregate = { error: err.message };
  }

  const processedAt = new Date().toISOString();

  // Write outputs
  writeFileSync(
    path.join(OUT_DIR, 'aggregate.json'),
    JSON.stringify(aggregate, null, 2)
  );
  writeFileSync(
    path.join(OUT_DIR, 'FINDINGS.md'),
    renderMarkdown(aggregate, perPlanLog, processedAt)
  );

  const rel = p => path.relative(ROOT, p);
  console.log('');
  console.log('Done.');
  console.log(`  ${rel(path.join(OUT_DIR, 'FINDINGS.md'))}    ← start here`);
  console.log(`  ${rel(path.join(OUT_DIR, 'aggregate.json'))}`);
  console.log(`  ${rel(OUT_DIR)}/<plan>.json  (one per PDF)`);

  if (aggregate.summary) {
    console.log('\n' + aggregate.summary);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
