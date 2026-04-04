import path from 'path';

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

export async function buildEvidenceLedger() {
  return null;
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
