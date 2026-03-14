type ProposalLike<TChange> = {
  coachReply: string;
  summary: string;
  riskFlags?: string[];
  changes: TChange[];
};

type WeekDurationSummary = {
  weekIndex: number;
  plannedDurationMin: number;
};

type DurationJumpArgs = {
  baseWeeks: WeekDurationSummary[];
  proposedWeeks: WeekDurationSummary[];
  touchedWeekIndexes: Set<number>;
};

function normalizeSentenceSpacing(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function rewriteCoachReplyAsRecommendation(text: string | null | undefined) {
  const source = normalizeSentenceSpacing(String(text || ""));
  if (!source) return "I recommend the following plan adjustment.";
  if (/\b(i|we)\s+(recommend|propose|suggest)\b/i.test(source)) return source;
  if (/\b(could not|cannot|can't|unable to)\b/i.test(source)) return source;

  let next = source
    .replace(/\b(alright|okay|ok)[,!]?\s*/gi, "")
    .replace(/\b(i|we)(?:'ve| have)\s+updated\s+the\s+plan\.?\s*/gi, "")
    .replace(/\bis now renamed to\b/gi, "should be renamed to")
    .replace(/\bis now named\b/gi, "should be renamed to")
    .replace(/\bhas been renamed to\b/gi, "should be renamed to")
    .trim();

  if (!next) {
    return "I recommend the following plan adjustment.";
  }

  next = next.replace(/^\W+/, "");
  if (!/[.?!]$/.test(next)) next = `${next}.`;
  return `I recommend this adjustment: ${next}`;
}

export function sanitizeProposalAfterLockedChanges<TChange, TProposal extends ProposalLike<TChange>>(
  proposal: TProposal,
  args: {
    removedCount: number;
    remainingChanges: TChange[];
  }
): TProposal {
  const { removedCount, remainingChanges } = args;
  if (removedCount <= 0) return proposal;

  const lockNote = `${removedCount} proposed change(s) were removed because completed days are locked.`;
  const riskFlags = [lockNote, ...(proposal.riskFlags || [])].slice(0, 6);

  if (remainingChanges.length === 0) {
    return {
      ...proposal,
      coachReply:
        "I could not recommend a direct plan change here because the targeted activity sits on a completed day, which is locked.",
      summary: "No applicable changes: completed days are locked.",
      riskFlags,
      changes: remainingChanges,
    };
  }

  return {
    ...proposal,
    coachReply: `${lockNote} ${rewriteCoachReplyAsRecommendation(proposal.coachReply)}`.trim(),
    summary: `Updated recommendation: ${proposal.summary}`,
    riskFlags,
    changes: remainingChanges,
  };
}

function buildDurationJumpMap(weeks: WeekDurationSummary[]) {
  const jumpByWeek = new Map<number, number>();
  for (let index = 1; index < weeks.length; index += 1) {
    const previous = weeks[index - 1];
    const current = weeks[index];
    if (previous.plannedDurationMin <= 0 || current.plannedDurationMin <= 0) continue;
    const deltaRatio = (current.plannedDurationMin - previous.plannedDurationMin) / previous.plannedDurationMin;
    if (deltaRatio > 0.2) {
      jumpByWeek.set(current.weekIndex, deltaRatio);
    }
  }
  return jumpByWeek;
}

export function collectDurationJumpDiagnostics(args: DurationJumpArgs) {
  const { baseWeeks, proposedWeeks, touchedWeekIndexes } = args;
  const baseJumpByWeek = buildDurationJumpMap(baseWeeks);
  const proposedJumpByWeek = buildDurationJumpMap(proposedWeeks);
  const diagnostics: string[] = [];
  const proposedWeekByIndex = new Map(proposedWeeks.map((week) => [week.weekIndex, week]));

  for (const [weekIndex, proposedRatio] of proposedJumpByWeek.entries()) {
    const currentWeek = proposedWeekByIndex.get(weekIndex);
    if (!currentWeek) continue;
    const previousWeek = proposedWeeks.find((week, index) => proposedWeeks[index + 1]?.weekIndex === weekIndex);
    const transitionTouched =
      touchedWeekIndexes.has(weekIndex) || (previousWeek ? touchedWeekIndexes.has(previousWeek.weekIndex) : false);
    if (!transitionTouched) continue;

    const baseRatio = baseJumpByWeek.get(weekIndex) ?? null;
    if (baseRatio !== null && proposedRatio <= baseRatio + 1e-9) continue;

    diagnostics.push(`Week ${weekIndex} duration jump exceeds 20%.`);
  }

  return diagnostics;
}
