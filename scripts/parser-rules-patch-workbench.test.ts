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

test("workbench applies deterministic guardrails and selects a representative eval set", async () => {
  const workbench = await import(patchWorkbenchModuleUrl);
  const ledger = {
    generated_at: "2026-04-04T00:00:00.000Z",
    source_files: ["plan-a.pdf", "plan-b.pdf", "plan-c.pdf", "plan-d.pdf"],
    rows: [
      {
        evidence_id: "evi-a1",
        file: "plan-a.pdf",
        evidence_kind: "unhandled_pattern",
        layout_type: "calendar_grid",
        source_units: "miles",
        total_weeks_detected: 12,
        summary: "Distance-only row",
        detail: "Parser misses distance-only rows.",
        suggested_rule: "Handle rows with only mileage.",
        abbreviation: null,
        example: null,
      },
      {
        evidence_id: "evi-a2",
        file: "plan-a.pdf",
        evidence_kind: "prompt_improvement",
        layout_type: "calendar_grid",
        source_units: "miles",
        total_weeks_detected: 12,
        summary: "Handle rows with only mileage.",
        detail: "Handle rows with only mileage.",
        suggested_rule: "Handle rows with only mileage.",
        abbreviation: null,
        example: null,
      },
      {
        evidence_id: "evi-b1",
        file: "plan-b.pdf",
        evidence_kind: "unhandled_pattern",
        layout_type: "sequential_table",
        source_units: "km",
        total_weeks_detected: 10,
        summary: "Branded workout block",
        detail: "Named challenge blocks show up in the plan.",
        suggested_rule: "Handle named challenge blocks.",
        abbreviation: null,
        example: null,
      },
      {
        evidence_id: "evi-c1",
        file: "plan-c.pdf",
        evidence_kind: "session_note",
        layout_type: "symbolic",
        source_units: "mixed",
        total_weeks_detected: 8,
        summary: "Symbol key row",
        detail: "Legend rows appear above the week grid.",
        suggested_rule: null,
        abbreviation: null,
        example: null,
      },
      {
        evidence_id: "evi-d1",
        file: "plan-d.pdf",
        evidence_kind: "new_abbreviation",
        layout_type: "frequency_based",
        source_units: "miles",
        total_weeks_detected: 6,
        summary: "ABC: aerobic base circuit",
        detail: "Circuit shorthand appears in notes.",
        suggested_rule: null,
        abbreviation: "ABC",
        example: "ABC + strides",
      },
    ],
    stats: {
      source_file_count: 4,
      row_count: 5,
      row_count_by_kind: {
        unhandled_pattern: 2,
        prompt_improvement: 1,
        new_abbreviation: 1,
        session_note: 1,
      },
    },
  };

  const candidates = {
    generated_at: "2026-04-04T00:00:00.000Z",
    candidates: [
      {
        candidate_id: "keep-1",
        cluster_id: "cluster-1",
        after_section: "RULES FOR WEEK TABLES:",
        insert_text: "Handle rows with only mileage when the cell omits a workout label.",
        rationale: "Improves distance-only row coverage.",
        evidence_ids: ["evi-a1", "evi-a2"],
      },
      {
        candidate_id: "duplicate-1",
        cluster_id: "cluster-1",
        after_section: "RULES FOR WEEK TABLES:",
        insert_text: "Handle rows with only mileage.",
        rationale: "Repeats existing prompt language.",
        evidence_ids: ["evi-a1", "evi-a2"],
      },
      {
        candidate_id: "anchor-1",
        cluster_id: "cluster-2",
        after_section: "SECTION THAT DOES NOT EXIST",
        insert_text: "Handle legend rows before the main grid.",
        rationale: "Needs a missing anchor check.",
        evidence_ids: ["evi-c1"],
      },
      {
        candidate_id: "support-1",
        cluster_id: "cluster-3",
        after_section: "RULES FOR WEEK TABLES:",
        insert_text: "Interpret ABC as aerobic base circuit.",
        rationale: "Only one supporting file should be rejected.",
        evidence_ids: ["evi-d1"],
      },
      {
        candidate_id: "brand-1",
        cluster_id: "cluster-4",
        after_section: "RULES FOR WEEK TABLES:",
        insert_text: "Recognize Race Refueled by Milk challenge blocks as workouts.",
        rationale: "Branded wording should be rejected.",
        evidence_ids: ["evi-b1", "evi-c1"],
      },
    ],
  };

  const review = await workbench.critiquePatchCandidates({
    ledger,
    clusters: {
      generated_at: "2026-04-04T00:00:00.000Z",
      clusters: [],
    },
    candidates,
    promptText: [
      "RULES FOR WEEK TABLES:",
      "Handle rows with only mileage.",
      "Interpret legend rows before week tables.",
    ].join("\n"),
    runStage: async () => ({
      accepted_candidates: candidates.candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        verdict: "keep",
        reason: "LLM accepted it.",
      })),
      rejected_candidates: [],
    }),
  });

  assert.deepEqual(
    review.accepted_candidates.map((candidate: { candidate_id: string }) => candidate.candidate_id),
    ["keep-1"],
    "expected only the supported, non-duplicate, non-branded candidate to survive guardrails",
  );
  assert.equal(
    review.rejected_candidates.some((candidate: { candidate_id: string; reason: string }) =>
      candidate.candidate_id === "duplicate-1" && /duplicate/i.test(candidate.reason)),
    true,
    "expected duplicate-rule rejection reason",
  );
  assert.equal(
    review.rejected_candidates.some((candidate: { candidate_id: string; reason: string }) =>
      candidate.candidate_id === "anchor-1" && /anchor/i.test(candidate.reason)),
    true,
    "expected missing-anchor rejection reason",
  );
  assert.equal(
    review.rejected_candidates.some((candidate: { candidate_id: string; reason: string }) =>
      candidate.candidate_id === "support-1" && /support/i.test(candidate.reason)),
    true,
    "expected weak-support rejection reason",
  );
  assert.equal(
    review.rejected_candidates.some((candidate: { candidate_id: string; reason: string }) =>
      candidate.candidate_id === "brand-1" && /brand|specific/i.test(candidate.reason)),
    true,
    "expected branded-wording rejection reason",
  );

  const evalSet = workbench.selectRepresentativeEvalSet(ledger, 4);
  assert.equal(evalSet.length, 4, "expected bounded eval-set size");
  assert.equal(new Set(evalSet.map((row: { layout_type: string }) => row.layout_type)).size >= 3, true, "expected eval set to cover multiple layouts");
  assert.equal(new Set(evalSet.map((row: { source_units: string }) => row.source_units)).size >= 2, true, "expected eval set to cover multiple unit types");
});

test("patch-workbench route exposes streaming stage events and resumable bundle reads", () => {
  const routeSource = readSource(PATCH_WORKBENCH_ROUTE);

  assert.ok(routeSource.includes("createNdjsonStream"), "expected patch-workbench POST to use NDJSON streaming");
  for (const eventName of [
    "stage_start",
    "stage_progress",
    "stage_complete",
    "candidate_preview",
    "eval_result",
    "complete",
    "error",
  ]) {
    assert.ok(routeSource.includes(eventName), `expected route to emit ${eventName}`);
  }

  assert.ok(routeSource.includes("final-adjustment-bundle.json"), "expected GET route to read the saved final bundle");
  assert.match(routeSource, /export\s+async\s+function\s+GET\b/, "expected resumable GET handler");
  assert.match(routeSource, /export\s+async\s+function\s+POST\b/, "expected streaming POST handler");
  assert.ok(!routeSource.includes("not_implemented"), "expected real workbench route implementation");
});
