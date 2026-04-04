import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LEGACY_PATCH_ROUTE = path.join(ROOT, "src/app/api/admin/parser-rules/patch/route.ts");
const PATCH_WORKBENCH_ROUTE = path.join(ROOT, "src/app/api/admin/parser-rules/patch-workbench/route.ts");
const PATCH_WORKBENCH_HELPER = path.join(ROOT, "src/lib/parser-rules/patch-workbench.ts");

const ARTIFACT_FILENAMES = [
  "evidence-ledger.json",
  "issue-clusters.json",
  "patch-candidates.json",
  "patch-review.json",
  "patch-eval.json",
  "final-adjustment-bundle.json",
];

const patchWorkbenchModuleUrl = new URL("../src/lib/parser-rules/patch-workbench.ts", import.meta.url).href;

function readSource(filePath: string) {
  return readFileSync(filePath, "utf8");
}

test("parser-rules patch workbench contract is scaffolded", () => {
  assert.equal(existsSync(PATCH_WORKBENCH_ROUTE), true, "expected dedicated patch-workbench API route");
  assert.equal(existsSync(PATCH_WORKBENCH_HELPER), true, "expected parser-rules workbench helper module");

  const legacySource = readSource(LEGACY_PATCH_ROUTE);
  const routeSource = readSource(PATCH_WORKBENCH_ROUTE);
  const helperSource = readSource(PATCH_WORKBENCH_HELPER);

  assert.match(routeSource, /export\s+async\s+function\s+GET\b/, "expected GET handler in patch-workbench route");
  assert.match(routeSource, /export\s+async\s+function\s+POST\b/, "expected POST handler in patch-workbench route");

  assert.match(helperSource, /PATCH_WORKBENCH_ARTIFACT_DIR/, "expected artifact directory export");

  for (const artifact of ARTIFACT_FILENAMES) {
    assert.ok(
      routeSource.includes(artifact) || helperSource.includes(artifact),
      `expected artifact reference for ${artifact}`,
    );
  }

  assert.ok(
    legacySource.includes("patch-workbench"),
    "expected legacy patch route to acknowledge the new patch-workbench entrypoint",
  );
});

test("buildEvidenceLedger reads saved analysis JSON and writes a stable evidence ledger", async () => {
  const {
    buildEvidenceLedger,
    PATCH_WORKBENCH_ARTIFACT_DIR,
    PATCH_WORKBENCH_ARTIFACTS,
  } = await import(patchWorkbenchModuleUrl);

  const ledger = await buildEvidenceLedger();
  assert.ok(ledger, "expected buildEvidenceLedger to return a ledger object");

  const analysisDir = path.join(ROOT, "scripts/parser-analysis");
  const expectedFiles = new Set(
    readdirSync(analysisDir).filter((name) => name.endsWith(".json") && name !== "aggregate.json")
  );
  assert.equal(typeof ledger.stats?.source_file_count, "number", "expected ledger stats");
  assert.equal(
    ledger.stats.source_file_count,
    expectedFiles.size,
    "expected ledger to read every saved per-PDF analysis file except aggregate.json",
  );

  assert.ok(Array.isArray(ledger.rows), "expected ledger rows array");
  assert.ok(ledger.rows.length > 0, "expected flattened evidence rows");

  const evidenceKinds = new Set(ledger.rows.map((row: { evidence_kind?: string }) => row.evidence_kind));
  assert.ok(evidenceKinds.has("unhandled_pattern"), "expected unhandled pattern rows");
  assert.ok(evidenceKinds.has("prompt_improvement"), "expected prompt improvement rows");
  assert.ok(evidenceKinds.has("new_abbreviation"), "expected new abbreviation rows");
  assert.ok(evidenceKinds.has("session_note"), "expected parsing-note session rows");

  for (const row of ledger.rows) {
    assert.equal(typeof row.evidence_id, "string", "expected stable evidence_id");
    assert.ok(row.evidence_id.length > 0, "expected non-empty evidence_id");
    assert.equal(typeof row.file, "string", "expected source file on each row");
    assert.equal(typeof row.evidence_kind, "string", "expected evidence kind on each row");
    assert.equal(typeof row.summary, "string", "expected evidence summary on each row");
  }

  const secondLedger = await buildEvidenceLedger();
  assert.deepEqual(
    ledger.rows.map((row: { evidence_id: string }) => row.evidence_id),
    secondLedger.rows.map((row: { evidence_id: string }) => row.evidence_id),
    "expected evidence IDs to remain stable across repeated runs",
  );

  const persistedLedgerPath = path.join(
    PATCH_WORKBENCH_ARTIFACT_DIR,
    PATCH_WORKBENCH_ARTIFACTS.evidenceLedger,
  );
  assert.equal(existsSync(persistedLedgerPath), true, "expected evidence ledger artifact to be written");
});

test("workbench staged helpers write intermediate artifacts", async () => {
  const workbench = await import(patchWorkbenchModuleUrl);
  const ledger = await workbench.buildEvidenceLedger();

  const stageResponses = [
    {
      clusters: [
        {
          cluster_id: "cluster-1",
          title: "Distance formatting gaps",
          evidence_ids: ledger.rows.slice(0, 2).map((row: { evidence_id: string }) => row.evidence_id),
          summary: "Distance notation is inconsistent across saved analyses.",
        },
      ],
    },
    {
      candidates: [
        {
          candidate_id: "candidate-1",
          cluster_id: "cluster-1",
          after_section: "RULES FOR WEEK TABLES:",
          insert_text: "Handle distance notation that appears without obvious session headers.",
          rationale: "Improves recovery of distance-only rows.",
          evidence_ids: ledger.rows.slice(0, 2).map((row: { evidence_id: string }) => row.evidence_id),
        },
      ],
    },
    {
      accepted_candidates: [
        {
          candidate_id: "candidate-1",
          verdict: "keep",
          reason: "Well supported by repeated saved evidence.",
        },
      ],
      rejected_candidates: [],
    },
    {
      evaluated_candidates: [
        {
          candidate_id: "candidate-1",
          coverage_gain: "medium",
          risk: "low",
          confidence: 0.78,
          representative_examples: ledger.rows.slice(0, 2).map((row: { evidence_id: string }) => row.evidence_id),
        },
      ],
    },
  ];

  let callIndex = 0;
  const runStage = async () => stageResponses[callIndex++];

  const clusters = await workbench.clusterIssues({
    ledger,
    promptText: "RULES FOR WEEK TABLES:",
    runStage,
  });
  assert.equal(Array.isArray(clusters.clusters), true, "expected cluster output");

  const candidates = await workbench.draftPatchCandidates({
    ledger,
    clusters,
    promptText: "RULES FOR WEEK TABLES:",
    runStage,
  });
  assert.equal(Array.isArray(candidates.candidates), true, "expected candidate output");

  const review = await workbench.critiquePatchCandidates({
    ledger,
    clusters,
    candidates,
    promptText: "RULES FOR WEEK TABLES:",
    runStage,
  });
  assert.equal(Array.isArray(review.accepted_candidates), true, "expected review output");

  const evaluation = await workbench.evaluatePatchCandidates({
    ledger,
    clusters,
    candidates,
    review,
    promptText: "RULES FOR WEEK TABLES:",
    runStage,
  });
  assert.equal(Array.isArray(evaluation.evaluated_candidates), true, "expected eval output");

  const finalBundle = await workbench.buildFinalAdjustmentBundle({
    ledger,
    clusters,
    candidates,
    review,
    evaluation,
    promptText: "RULES FOR WEEK TABLES:",
  });
  assert.equal(Array.isArray(finalBundle.final_adjustments), true, "expected final bundle adjustments");

  for (const artifact of [
    workbench.PATCH_WORKBENCH_ARTIFACTS.issueClusters,
    workbench.PATCH_WORKBENCH_ARTIFACTS.patchCandidates,
    workbench.PATCH_WORKBENCH_ARTIFACTS.patchReview,
    workbench.PATCH_WORKBENCH_ARTIFACTS.patchEval,
    workbench.PATCH_WORKBENCH_ARTIFACTS.finalAdjustmentBundle,
  ]) {
    const artifactPath = path.join(workbench.PATCH_WORKBENCH_ARTIFACT_DIR, artifact);
    assert.equal(existsSync(artifactPath), true, `expected ${artifact} artifact to be written`);
  }
});
