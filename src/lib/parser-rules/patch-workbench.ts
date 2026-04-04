import { createHash } from 'crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const SAVED_ANALYSIS_DIR = path.join(process.cwd(), 'scripts', 'parser-analysis');

export const PATCH_WORKBENCH_ARTIFACT_DIR = path.join(
  process.cwd(),
  'scripts',
  'parser-analysis',
  'patch-workbench',
);

export const PATCH_WORKBENCH_ARTIFACTS = {
  evidenceLedger: 'evidence-ledger.json',
  issueClusters: 'issue-clusters.json',
  patchCandidates: 'patch-candidates.json',
  patchReview: 'patch-review.json',
  patchEval: 'patch-eval.json',
  finalAdjustmentBundle: 'final-adjustment-bundle.json',
} as const;

export interface SessionSample {
  raw?: string | null;
  day?: string | null;
  type?: string | null;
  distance?: string | null;
  parsing_note?: string | null;
}

export interface UnhandledPattern {
  pattern?: string | null;
  issue?: string | null;
  suggested_rule?: string | null;
}

export interface NewAbbreviation {
  abbr?: string | null;
  meaning?: string | null;
  example?: string | null;
}

export interface PlanAnalysis {
  layout_type?: string | null;
  source_units?: string | null;
  total_weeks_detected?: number | null;
  sessions_sample?: SessionSample[] | null;
  unhandled_patterns?: UnhandledPattern[] | null;
  new_abbreviations?: NewAbbreviation[] | null;
  prompt_improvements?: string[] | null;
}

export interface SavedPlanAnalysisEntry {
  file: string;
  text_chars?: number;
  analysis: PlanAnalysis;
}

export type EvidenceKind =
  | 'unhandled_pattern'
  | 'prompt_improvement'
  | 'new_abbreviation'
  | 'session_note';

export interface EvidenceLedgerRow {
  evidence_id: string;
  file: string;
  evidence_kind: EvidenceKind;
  layout_type: string | null;
  source_units: string | null;
  total_weeks_detected: number | null;
  summary: string;
  detail: string;
  suggested_rule: string | null;
  abbreviation: string | null;
  example: string | null;
}

export interface EvidenceLedgerStats {
  source_file_count: number;
  row_count: number;
  row_count_by_kind: Record<EvidenceKind, number>;
}

export interface EvidenceLedger {
  generated_at: string;
  source_files: string[];
  rows: EvidenceLedgerRow[];
  stats: EvidenceLedgerStats;
}

function hashEvidence(parts: Array<string | number | null | undefined>) {
  const normalized = parts.map((part) => String(part ?? '')).join('::');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() || '';
}

function buildEvidenceId(
  file: string,
  evidenceKind: EvidenceKind,
  detail: string,
  extra?: string | null,
) {
  return `evi_${hashEvidence([file, evidenceKind, detail, extra])}`;
}

export function readSavedPlanAnalyses(): SavedPlanAnalysisEntry[] {
  const filenames = readdirSync(SAVED_ANALYSIS_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'aggregate.json')
    .sort();

  return filenames.map((filename) => {
    const fullPath = path.join(SAVED_ANALYSIS_DIR, filename);
    return JSON.parse(readFileSync(fullPath, 'utf8')) as SavedPlanAnalysisEntry;
  });
}

function toUnhandledPatternRows(entry: SavedPlanAnalysisEntry): EvidenceLedgerRow[] {
  return (entry.analysis.unhandled_patterns ?? []).map((pattern) => {
    const summary = normalizeText(pattern.pattern) || normalizeText(pattern.issue);
    const detail = normalizeText(pattern.issue);
    const suggestedRule = normalizeText(pattern.suggested_rule);

    return {
      evidence_id: buildEvidenceId(entry.file, 'unhandled_pattern', summary, suggestedRule),
      file: entry.file,
      evidence_kind: 'unhandled_pattern',
      layout_type: entry.analysis.layout_type ?? null,
      source_units: entry.analysis.source_units ?? null,
      total_weeks_detected: entry.analysis.total_weeks_detected ?? null,
      summary,
      detail,
      suggested_rule: suggestedRule || null,
      abbreviation: null,
      example: null,
    };
  });
}

function toPromptImprovementRows(entry: SavedPlanAnalysisEntry): EvidenceLedgerRow[] {
  return (entry.analysis.prompt_improvements ?? []).map((improvement) => {
    const summary = normalizeText(improvement);

    return {
      evidence_id: buildEvidenceId(entry.file, 'prompt_improvement', summary),
      file: entry.file,
      evidence_kind: 'prompt_improvement',
      layout_type: entry.analysis.layout_type ?? null,
      source_units: entry.analysis.source_units ?? null,
      total_weeks_detected: entry.analysis.total_weeks_detected ?? null,
      summary,
      detail: summary,
      suggested_rule: summary || null,
      abbreviation: null,
      example: null,
    };
  });
}

function toAbbreviationRows(entry: SavedPlanAnalysisEntry): EvidenceLedgerRow[] {
  return (entry.analysis.new_abbreviations ?? []).map((abbreviation) => {
    const abbr = normalizeText(abbreviation.abbr);
    const meaning = normalizeText(abbreviation.meaning);
    const example = normalizeText(abbreviation.example);

    return {
      evidence_id: buildEvidenceId(entry.file, 'new_abbreviation', abbr, meaning),
      file: entry.file,
      evidence_kind: 'new_abbreviation',
      layout_type: entry.analysis.layout_type ?? null,
      source_units: entry.analysis.source_units ?? null,
      total_weeks_detected: entry.analysis.total_weeks_detected ?? null,
      summary: [abbr, meaning].filter(Boolean).join(': '),
      detail: meaning,
      suggested_rule: null,
      abbreviation: abbr || null,
      example: example || null,
    };
  });
}

function toSessionNoteRows(entry: SavedPlanAnalysisEntry): EvidenceLedgerRow[] {
  return (entry.analysis.sessions_sample ?? [])
    .filter((session) => normalizeText(session.parsing_note))
    .map((session) => {
      const raw = normalizeText(session.raw);
      const parsingNote = normalizeText(session.parsing_note);

      return {
        evidence_id: buildEvidenceId(entry.file, 'session_note', raw, parsingNote),
        file: entry.file,
        evidence_kind: 'session_note',
        layout_type: entry.analysis.layout_type ?? null,
        source_units: entry.analysis.source_units ?? null,
        total_weeks_detected: entry.analysis.total_weeks_detected ?? null,
        summary: raw || parsingNote,
        detail: parsingNote,
        suggested_rule: null,
        abbreviation: null,
        example: null,
      };
    });
}

function createEvidenceRows(entry: SavedPlanAnalysisEntry) {
  return [
    ...toUnhandledPatternRows(entry),
    ...toPromptImprovementRows(entry),
    ...toAbbreviationRows(entry),
    ...toSessionNoteRows(entry),
  ];
}

export async function buildEvidenceLedger(): Promise<EvidenceLedger> {
  const analyses = readSavedPlanAnalyses();
  const rows = analyses.flatMap(createEvidenceRows);
  const stats: EvidenceLedgerStats = {
    source_file_count: analyses.length,
    row_count: rows.length,
    row_count_by_kind: {
      unhandled_pattern: rows.filter((row) => row.evidence_kind === 'unhandled_pattern').length,
      prompt_improvement: rows.filter((row) => row.evidence_kind === 'prompt_improvement').length,
      new_abbreviation: rows.filter((row) => row.evidence_kind === 'new_abbreviation').length,
      session_note: rows.filter((row) => row.evidence_kind === 'session_note').length,
    },
  };

  const ledger: EvidenceLedger = {
    generated_at: new Date().toISOString(),
    source_files: analyses.map((entry) => entry.file),
    rows,
    stats,
  };

  mkdirSync(PATCH_WORKBENCH_ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    path.join(PATCH_WORKBENCH_ARTIFACT_DIR, PATCH_WORKBENCH_ARTIFACTS.evidenceLedger),
    JSON.stringify(ledger, null, 2),
  );

  return ledger;
}

export async function clusterIssues() {
  return null;
}

export async function draftPatchCandidates() {
  return null;
}

export async function critiquePatchCandidates() {
  return null;
}

export async function evaluatePatchCandidates() {
  return null;
}

export async function buildFinalAdjustmentBundle() {
  return null;
}
