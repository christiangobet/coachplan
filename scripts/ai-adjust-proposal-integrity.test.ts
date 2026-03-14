import test from "node:test";
import assert from "node:assert/strict";

type ProposalChange = {
  op: "edit_activity";
  activityId: string;
  reason: string;
  title?: string;
};

type ProposalShape = {
  schemaVersion?: string;
  coachReply: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  changes: ProposalChange[];
  riskFlags?: string[];
};

const {
  collectDurationJumpDiagnostics,
  rewriteCoachReplyAsRecommendation,
  sanitizeProposalAfterLockedChanges,
} = await import(
  new URL("../src/lib/ai-trainer-proposal-integrity.ts", import.meta.url).href
);

function createProposal(overrides: Partial<ProposalShape> = {}): ProposalShape {
  return {
    schemaVersion: "1",
    coachReply: "Alright, I've updated the plan. The hike is now renamed to Hike.",
    summary: "Renamed the hike activity.",
    confidence: "high",
    changes: [
      {
        op: "edit_activity",
        activityId: "activity-1",
        reason: "Rename Murren Hike to Hike for better clarity.",
        title: "Hike",
      },
    ],
    ...overrides,
  };
}

test("locked-day sanitization rewrites coach copy when all changes are removed", () => {
  const proposal = createProposal();

  const sanitized = sanitizeProposalAfterLockedChanges(proposal, {
    removedCount: 1,
    remainingChanges: [],
  });

  assert.equal(sanitized.changes.length, 0);
  assert.equal(sanitized.summary, "No applicable changes: completed days are locked.");
  assert.match(sanitized.coachReply, /completed day|locked/i);
  assert.doesNotMatch(sanitized.coachReply, /I've updated the plan|is now renamed/i);
});

test("rewriteCoachReplyAsRecommendation keeps copy in proposal tense", () => {
  const rewritten = rewriteCoachReplyAsRecommendation(
    "Alright, I've updated the plan. The Murren Hike activity is now named Hike for better clarity."
  );

  assert.match(rewritten, /recommend|propose/i);
  assert.doesNotMatch(rewritten, /I've updated the plan|is now named/i);
});

test("duration jump diagnostics only surface newly introduced jumps", () => {
  const diagnostics = collectDurationJumpDiagnostics({
    baseWeeks: [
      { weekIndex: 5, plannedDurationMin: 100 },
      { weekIndex: 6, plannedDurationMin: 130 },
      { weekIndex: 7, plannedDurationMin: 170 },
    ],
    proposedWeeks: [
      { weekIndex: 5, plannedDurationMin: 100 },
      { weekIndex: 6, plannedDurationMin: 130 },
      { weekIndex: 7, plannedDurationMin: 170 },
    ],
    touchedWeekIndexes: new Set([2]),
  });

  assert.deepEqual(diagnostics, []);
});

test("duration jump diagnostics surface touched-week regressions", () => {
  const diagnostics = collectDurationJumpDiagnostics({
    baseWeeks: [
      { weekIndex: 5, plannedDurationMin: 100 },
      { weekIndex: 6, plannedDurationMin: 110 },
      { weekIndex: 7, plannedDurationMin: 112 },
    ],
    proposedWeeks: [
      { weekIndex: 5, plannedDurationMin: 100 },
      { weekIndex: 6, plannedDurationMin: 150 },
      { weekIndex: 7, plannedDurationMin: 112 },
    ],
    touchedWeekIndexes: new Set([6]),
  });

  assert.deepEqual(diagnostics, ["Week 6 duration jump exceeds 20%."]);
});
