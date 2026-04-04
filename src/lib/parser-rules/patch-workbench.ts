import { createHash } from 'crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { getDefaultAiModel, openaiJsonSchema } from '../openai.ts';

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

export interface IssueCluster {
  cluster_id: string;
  title: string;
  evidence_ids: string[];
  summary: string;
}

export interface IssueClustersArtifact {
  generated_at: string;
  clusters: IssueCluster[];
}

export interface PatchCandidate {
  candidate_id: string;
  cluster_id: string;
  after_section: string;
  insert_text: string;
  rationale: string;
  evidence_ids: string[];
}

export interface PatchCandidatesArtifact {
  generated_at: string;
  candidates: PatchCandidate[];
}

export interface PatchReviewDecision {
  candidate_id: string;
  verdict: string;
  reason: string;
}

export interface PatchReviewArtifact {
  generated_at: string;
  accepted_candidates: PatchReviewDecision[];
  rejected_candidates: PatchReviewDecision[];
}

export interface PatchEvaluationResult {
  candidate_id: string;
  coverage_gain: string;
  risk: string;
  confidence: number;
  representative_examples: string[];
}

export interface PatchEvalArtifact {
  generated_at: string;
  evaluated_candidates: PatchEvaluationResult[];
}

export interface FinalAdjustment {
  candidate_id: string;
  after_section: string;
  insert_text: string;
  rationale: string;
  confidence: number;
  risk: string;
  coverage_gain: string;
  evidence_ids: string[];
}

export interface RejectedOrMergedIdea {
  candidate_id: string;
  verdict: string;
  reason: string;
}

export interface FinalAdjustmentBundle {
  generated_at: string;
  final_adjustments: FinalAdjustment[];
  rejected_or_merged: RejectedOrMergedIdea[];
}

type StageRunnerInput = {
  stage: string;
  prompt: string;
  schema: {
    name: string;
    schema: Record<string, unknown>;
  };
};

type StageRunner = <T>(input: StageRunnerInput) => Promise<T>;

type ClusterIssuesArgs = {
  ledger: EvidenceLedger;
  promptText: string;
  runStage?: StageRunner;
};

type DraftPatchCandidatesArgs = {
  ledger: EvidenceLedger;
  clusters: IssueClustersArtifact;
  promptText: string;
  runStage?: StageRunner;
};

type CritiquePatchCandidatesArgs = {
  ledger: EvidenceLedger;
  clusters: IssueClustersArtifact;
  candidates: PatchCandidatesArtifact;
  promptText: string;
  runStage?: StageRunner;
};

type EvaluatePatchCandidatesArgs = {
  ledger: EvidenceLedger;
  clusters: IssueClustersArtifact;
  candidates: PatchCandidatesArtifact;
  review: PatchReviewArtifact;
  promptText: string;
  runStage?: StageRunner;
};

type BuildFinalAdjustmentBundleArgs = {
  ledger: EvidenceLedger;
  clusters: IssueClustersArtifact;
  candidates: PatchCandidatesArtifact;
  review: PatchReviewArtifact;
  evaluation: PatchEvalArtifact;
  promptText: string;
};

const MIN_SUPPORTING_EVIDENCE = 2;
const BRANDED_WORDING_PATTERNS = [
  /\brace refueled by milk\b/i,
  /\bfind your strong\b/i,
  /\bgo the distance\b/i,
  /\bchallenge\b/i,
  /\bclub\b/i,
];

function hashEvidence(parts: Array<string | number | null | undefined>) {
  const normalized = parts.map((part) => String(part ?? '')).join('::');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() || '';
}

function writeWorkbenchArtifact<T>(filename: string, payload: T) {
  mkdirSync(PATCH_WORKBENCH_ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    path.join(PATCH_WORKBENCH_ARTIFACT_DIR, filename),
    JSON.stringify(payload, null, 2),
  );
  return payload;
}

function buildStageRunner(runStage?: StageRunner): StageRunner {
  if (runStage) return runStage;

  return async <T>({ prompt, schema }: StageRunnerInput) =>
    openaiJsonSchema<T>({
      model: getDefaultAiModel(),
      input: prompt,
      schema: {
        name: schema.name,
        schema: schema.schema,
        strict: true,
      },
      maxOutputTokens: 4000,
    });
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

  return writeWorkbenchArtifact(PATCH_WORKBENCH_ARTIFACTS.evidenceLedger, ledger);
}

function buildClusterPrompt(ledger: EvidenceLedger, promptText: string) {
  return [
    'Group parser evidence into issue clusters for prompt patch planning.',
    'Focus on reusable issues, not one-off PDF quirks.',
    `Current parser prompt:\n${promptText}`,
    `Evidence rows:\n${JSON.stringify(ledger.rows, null, 2)}`,
    'Return strict JSON with clusters[]. Each cluster needs cluster_id, title, evidence_ids, and summary.',
  ].join('\n\n');
}

function buildDraftPrompt(
  ledger: EvidenceLedger,
  clusters: IssueClustersArtifact,
  promptText: string,
) {
  return [
    'Draft parser prompt insertions from clustered evidence.',
    `Current parser prompt:\n${promptText}`,
    `Issue clusters:\n${JSON.stringify(clusters, null, 2)}`,
    `Supporting evidence:\n${JSON.stringify(ledger.rows, null, 2)}`,
    'Return strict JSON with candidates[]. Each candidate needs candidate_id, cluster_id, after_section, insert_text, rationale, and evidence_ids.',
  ].join('\n\n');
}

function buildCritiquePrompt(
  clusters: IssueClustersArtifact,
  candidates: PatchCandidatesArtifact,
  promptText: string,
) {
  return [
    'Critique parser prompt candidates for duplication, overfitting, and weak support.',
    `Current parser prompt:\n${promptText}`,
    `Issue clusters:\n${JSON.stringify(clusters, null, 2)}`,
    `Candidate patches:\n${JSON.stringify(candidates, null, 2)}`,
    'Return strict JSON with accepted_candidates[] and rejected_candidates[]. Each decision needs candidate_id, verdict, and reason.',
  ].join('\n\n');
}

function buildEvalPrompt(
  ledger: EvidenceLedger,
  review: PatchReviewArtifact,
  candidates: PatchCandidatesArtifact,
  promptText: string,
) {
  const evalSet = selectRepresentativeEvalSet(ledger, 8);
  return [
    'Evaluate reviewed parser prompt candidates for coverage gain, risk, and confidence.',
    `Current parser prompt:\n${promptText}`,
    `Reviewed candidates:\n${JSON.stringify(review, null, 2)}`,
    `Candidate details:\n${JSON.stringify(candidates, null, 2)}`,
    `Representative eval set:\n${JSON.stringify(evalSet, null, 2)}`,
    'Return strict JSON with evaluated_candidates[]. Each result needs candidate_id, coverage_gain, risk, confidence, and representative_examples.',
  ].join('\n\n');
}

const CLUSTER_SCHEMA = {
  name: 'parser_rules_issue_clusters',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      clusters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cluster_id: { type: 'string' },
            title: { type: 'string' },
            evidence_ids: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['cluster_id', 'title', 'evidence_ids', 'summary'],
        },
      },
    },
    required: ['clusters'],
  },
} as const;

const CANDIDATE_SCHEMA = {
  name: 'parser_rules_patch_candidates',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_id: { type: 'string' },
            cluster_id: { type: 'string' },
            after_section: { type: 'string' },
            insert_text: { type: 'string' },
            rationale: { type: 'string' },
            evidence_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['candidate_id', 'cluster_id', 'after_section', 'insert_text', 'rationale', 'evidence_ids'],
        },
      },
    },
    required: ['candidates'],
  },
} as const;

const REVIEW_SCHEMA = {
  name: 'parser_rules_patch_review',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      accepted_candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_id: { type: 'string' },
            verdict: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['candidate_id', 'verdict', 'reason'],
        },
      },
      rejected_candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_id: { type: 'string' },
            verdict: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['candidate_id', 'verdict', 'reason'],
        },
      },
    },
    required: ['accepted_candidates', 'rejected_candidates'],
  },
} as const;

const EVAL_SCHEMA = {
  name: 'parser_rules_patch_eval',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      evaluated_candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_id: { type: 'string' },
            coverage_gain: { type: 'string' },
            risk: { type: 'string' },
            confidence: { type: 'number' },
            representative_examples: { type: 'array', items: { type: 'string' } },
          },
          required: ['candidate_id', 'coverage_gain', 'risk', 'confidence', 'representative_examples'],
        },
      },
    },
    required: ['evaluated_candidates'],
  },
} as const;

export async function clusterIssues({
  ledger,
  promptText,
  runStage,
}: ClusterIssuesArgs): Promise<IssueClustersArtifact> {
  const response = await buildStageRunner(runStage)<{ clusters: IssueCluster[] }>({
    stage: 'cluster_issues',
    prompt: buildClusterPrompt(ledger, promptText),
    schema: CLUSTER_SCHEMA,
  });

  return writeWorkbenchArtifact(PATCH_WORKBENCH_ARTIFACTS.issueClusters, {
    generated_at: new Date().toISOString(),
    clusters: response.clusters ?? [],
  });
}

export async function draftPatchCandidates({
  ledger,
  clusters,
  promptText,
  runStage,
}: DraftPatchCandidatesArgs): Promise<PatchCandidatesArtifact> {
  const response = await buildStageRunner(runStage)<{ candidates: PatchCandidate[] }>({
    stage: 'draft_patch_candidates',
    prompt: buildDraftPrompt(ledger, clusters, promptText),
    schema: CANDIDATE_SCHEMA,
  });

  return writeWorkbenchArtifact(PATCH_WORKBENCH_ARTIFACTS.patchCandidates, {
    generated_at: new Date().toISOString(),
    candidates: response.candidates ?? [],
  });
}

export async function critiquePatchCandidates({
  ledger,
  clusters,
  candidates,
  promptText,
  runStage,
}: CritiquePatchCandidatesArgs): Promise<PatchReviewArtifact> {
  const response = await buildStageRunner(runStage)<{
    accepted_candidates: PatchReviewDecision[];
    rejected_candidates: PatchReviewDecision[];
  }>({
    stage: 'critique_patch_candidates',
    prompt: buildCritiquePrompt(clusters, candidates, promptText),
    schema: REVIEW_SCHEMA,
  });

  const deterministicRejections = new Map<string, PatchReviewDecision>();
  for (const candidate of candidates.candidates) {
    const reasons = getDeterministicReviewReasons(candidate, ledger, promptText);
    if (reasons.length === 0) continue;
    deterministicRejections.set(candidate.candidate_id, {
      candidate_id: candidate.candidate_id,
      verdict: 'reject',
      reason: reasons.join(' '),
    });
  }

  const acceptedCandidates = (response.accepted_candidates ?? [])
    .filter((candidate) => !deterministicRejections.has(candidate.candidate_id));

  const rejectedCandidates = [
    ...(response.rejected_candidates ?? []).filter(
      (candidate, index, list) => list.findIndex((item) => item.candidate_id === candidate.candidate_id) === index,
    ),
    ...deterministicRejections.values(),
  ].filter((candidate, index, list) => list.findIndex((item) => item.candidate_id === candidate.candidate_id) === index);

  return writeWorkbenchArtifact(PATCH_WORKBENCH_ARTIFACTS.patchReview, {
    generated_at: new Date().toISOString(),
    accepted_candidates: acceptedCandidates,
    rejected_candidates: rejectedCandidates,
  });
}

export async function evaluatePatchCandidates({
  ledger,
  clusters: _clusters,
  candidates,
  review,
  promptText,
  runStage,
}: EvaluatePatchCandidatesArgs): Promise<PatchEvalArtifact> {
  const response = await buildStageRunner(runStage)<{
    evaluated_candidates: PatchEvaluationResult[];
  }>({
    stage: 'evaluate_patch_candidates',
    prompt: buildEvalPrompt(ledger, review, candidates, promptText),
    schema: EVAL_SCHEMA,
  });

  return writeWorkbenchArtifact(PATCH_WORKBENCH_ARTIFACTS.patchEval, {
    generated_at: new Date().toISOString(),
    evaluated_candidates: response.evaluated_candidates ?? [],
  });
}

export async function buildFinalAdjustmentBundle({
  candidates,
  review,
  evaluation,
}: BuildFinalAdjustmentBundleArgs): Promise<FinalAdjustmentBundle> {
  const candidateMap = new Map(candidates.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const evaluationMap = new Map(
    evaluation.evaluated_candidates.map((candidate) => [candidate.candidate_id, candidate]),
  );

  const finalAdjustments: FinalAdjustment[] = review.accepted_candidates.flatMap((decision) => {
    const candidate = candidateMap.get(decision.candidate_id);
    const evalResult = evaluationMap.get(decision.candidate_id);
    if (!candidate || !evalResult) return [];

    return [{
      candidate_id: candidate.candidate_id,
      after_section: candidate.after_section,
      insert_text: candidate.insert_text,
      rationale: candidate.rationale,
      confidence: evalResult.confidence,
      risk: evalResult.risk,
      coverage_gain: evalResult.coverage_gain,
      evidence_ids: candidate.evidence_ids,
    }];
  });

  const rejectedOrMerged = review.rejected_candidates.map((decision) => ({
    candidate_id: decision.candidate_id,
    verdict: decision.verdict,
    reason: decision.reason,
  }));

  return writeWorkbenchArtifact(PATCH_WORKBENCH_ARTIFACTS.finalAdjustmentBundle, {
    generated_at: new Date().toISOString(),
    final_adjustments: finalAdjustments,
    rejected_or_merged: rejectedOrMerged,
  });
}

function countSupportingFiles(candidate: PatchCandidate, ledger: EvidenceLedger) {
  const files = new Set(
    ledger.rows
      .filter((row) => candidate.evidence_ids.includes(row.evidence_id))
      .map((row) => row.file),
  );
  return files.size;
}

export function selectRepresentativeEvalSet(ledger: EvidenceLedger, limit: number) {
  const remaining = [...ledger.rows];
  const selected: EvidenceLedgerRow[] = [];
  const seenLayouts = new Set<string>();
  const seenUnits = new Set<string>();
  const seenKinds = new Set<string>();

  while (remaining.length > 0 && selected.length < limit) {
    remaining.sort((left, right) => {
      const leftScore = scoreEvalRow(left, seenLayouts, seenUnits, seenKinds);
      const rightScore = scoreEvalRow(right, seenLayouts, seenUnits, seenKinds);
      return rightScore - leftScore || left.file.localeCompare(right.file) || left.evidence_id.localeCompare(right.evidence_id);
    });

    const next = remaining.shift();
    if (!next) break;
    selected.push(next);
    if (next.layout_type) seenLayouts.add(next.layout_type);
    if (next.source_units) seenUnits.add(next.source_units);
    seenKinds.add(next.evidence_kind);
  }

  return selected;
}

function scoreEvalRow(
  row: EvidenceLedgerRow,
  seenLayouts: Set<string>,
  seenUnits: Set<string>,
  seenKinds: Set<string>,
) {
  let score = 0;
  if (row.layout_type && !seenLayouts.has(row.layout_type)) score += 4;
  if (row.source_units && !seenUnits.has(row.source_units)) score += 3;
  if (!seenKinds.has(row.evidence_kind)) score += 2;
  score += Math.min(row.summary.length, 80) / 80;
  return score;
}

function getDeterministicReviewReasons(
  candidate: PatchCandidate,
  ledger: EvidenceLedger,
  promptText: string,
) {
  const reasons: string[] = [];

  if (isDuplicateExistingRule(candidate.insert_text, promptText)) {
    reasons.push('Rejected as a duplicate of an existing prompt rule.');
  }

  if (!hasValidAnchor(candidate.after_section, promptText)) {
    reasons.push('Rejected because the anchor text is missing or too fragile to place reliably.');
  }

  if (candidate.evidence_ids.length < MIN_SUPPORTING_EVIDENCE || countSupportingFiles(candidate, ledger) < 1) {
    reasons.push('Rejected for weak support because it does not have enough supporting evidence.');
  }

  if (hasOverlySpecificOrBrandedWording(candidate.insert_text)) {
    reasons.push('Rejected because the proposed wording is too brand-specific or overly specific.');
  }

  return reasons;
}

function normalizeRuleText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isDuplicateExistingRule(insertText: string, promptText: string) {
  const normalizedInsert = normalizeRuleText(insertText);
  if (!normalizedInsert) return false;

  return promptText
    .split('\n')
    .map((line) => normalizeRuleText(line))
    .some((line) => {
      if (!line) return false;
      if (line === normalizedInsert) return true;
      if (line.includes(normalizedInsert) || normalizedInsert.includes(line)) {
        const difference = Math.abs(line.length - normalizedInsert.length);
        return difference <= 12;
      }
      return false;
    });
}

export function hasValidAnchor(anchor: string, promptText: string) {
  const trimmedAnchor = anchor.trim();
  if (!trimmedAnchor) return false;
  return promptText.includes(trimmedAnchor);
}

export function hasOverlySpecificOrBrandedWording(insertText: string) {
  return BRANDED_WORDING_PATTERNS.some((pattern) => pattern.test(insertText));
}
