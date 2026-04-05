import type { ProgramJsonV1, SessionV1, WeekV1 } from "../schemas/program-json-v1";

export type GoldCorpusEntry = {
  id: string;
  layoutFamily: string;
  guide: string;
  program: ProgramJsonV1;
};

export type GoldCorpusCandidateResult = {
  guide: string;
  program: ProgramJsonV1;
  latencyMs: number;
  estimatedCostUsd: number;
};

export type GoldCorpusScore = {
  overall: number;
  breakdown: {
    weekDetection: number;
    dayAssignment: number;
    activityTyping: number;
    rawTextPreservation: number;
    notesCoverage: number;
    structureCoverage: number;
    guideCompleteness: number;
    nullHandling: number;
  };
  latencyMs: number;
  estimatedCostUsd: number;
};

export function scoreProgramAgainstGold(
  expected: GoldCorpusEntry,
  actual: GoldCorpusCandidateResult,
): GoldCorpusScore {
  const expectedWeeks = expected.program.weeks;
  const actualWeeks = actual.program.weeks;
  const expectedSessions = flattenSessions(expectedWeeks);
  const actualSessions = flattenSessions(actualWeeks);

  const weekDetection = ratio(
    expectedWeeks.map((week) => week.week_number),
    actualWeeks.map((week) => week.week_number),
  );

  const matchedSessions = expectedSessions.map((session) => {
    const match = findClosestSession(session, actualSessions);
    return { expected: session, actual: match };
  });

  const dayAssignment = average(
    matchedSessions.map(({ expected: session, actual: match }) =>
      match && match.day_of_week === session.day_of_week ? 1 : 0,
    ),
  );

  const activityTyping = average(
    matchedSessions.map(({ expected: session, actual: match }) =>
      match && match.activity_type === session.activity_type ? 1 : 0,
    ),
  );

  const rawTextPreservation = average(
    matchedSessions.map(({ expected: session, actual: match }) =>
      textSimilarity(session.raw_text, match?.raw_text ?? ""),
    ),
  );

  const notesCoverage = average(
    matchedSessions.map(({ expected: session, actual: match }) => {
      const expectedNotes = session.notes ?? session.coaching_note ?? null;
      const actualNotes = match?.notes ?? match?.coaching_note ?? null;
      if (!expectedNotes && !actualNotes) return 1;
      if (!expectedNotes && actualNotes) return 0;
      return textSimilarity(expectedNotes || "", actualNotes || "");
    }),
  );

  const structureCoverage = average(
    matchedSessions.map(({ expected: session, actual: match }) => {
      const expectedSteps = session.steps || [];
      const actualSteps = match?.steps || [];
      if (expectedSteps.length === 0 && actualSteps.length === 0) return 1;
      if (expectedSteps.length === 0 || actualSteps.length === 0) return 0;
      const expectedTypes = expectedSteps.map((step) => step.type);
      const actualTypes = actualSteps.map((step) => step.type);
      return ratio(expectedTypes, actualTypes);
    }),
  );

  const guideCompleteness = textSimilarity(expected.guide, actual.guide);
  const nullHandling = scoreNullHandling(expected.program, actual.program);

  const overall = average([
    weekDetection,
    dayAssignment,
    activityTyping,
    rawTextPreservation,
    notesCoverage,
    structureCoverage,
    guideCompleteness,
    nullHandling,
  ]);

  return {
    overall: rounded(overall),
    breakdown: {
      weekDetection: rounded(weekDetection),
      dayAssignment: rounded(dayAssignment),
      activityTyping: rounded(activityTyping),
      rawTextPreservation: rounded(rawTextPreservation),
      notesCoverage: rounded(notesCoverage),
      structureCoverage: rounded(structureCoverage),
      guideCompleteness: rounded(guideCompleteness),
      nullHandling: rounded(nullHandling),
    },
    latencyMs: actual.latencyMs,
    estimatedCostUsd: actual.estimatedCostUsd,
  };
}

function flattenSessions(weeks: WeekV1[]) {
  return weeks.flatMap((week) =>
    week.sessions.map((session, index) => ({
      ...session,
      week_number: week.week_number,
      session_index: index,
      week_brief: week.week_brief ?? null,
    })),
  );
}

function findClosestSession(
  expected: ReturnType<typeof flattenSessions>[number],
  actualSessions: ReturnType<typeof flattenSessions>,
) {
  const expectedRaw = normalizeText(expected.raw_text);
  let best: ReturnType<typeof flattenSessions>[number] | null = null;
  let bestScore = -1;

  for (const candidate of actualSessions) {
    let score = 0;
    if (candidate.week_number === expected.week_number) score += 4;
    if (candidate.day_of_week === expected.day_of_week) score += 2;
    if (candidate.activity_type === expected.activity_type) score += 2;
    if (normalizeText(candidate.raw_text) === expectedRaw) score += 5;
    else score += textSimilarity(candidate.raw_text, expected.raw_text) * 3;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function scoreNullHandling(expected: ProgramJsonV1, actual: ProgramJsonV1) {
  const expectedSessions = flattenSessions(expected.weeks);
  const actualSessions = flattenSessions(actual.weeks);
  const comparisons: number[] = [];

  for (const expectedSession of expectedSessions) {
    const actualSession = findClosestSession(expectedSession, actualSessions);
    comparisons.push(compareNullable(expectedSession.notes ?? null, actualSession?.notes ?? null));
    comparisons.push(compareNullable(expectedSession.coaching_note ?? null, actualSession?.coaching_note ?? null));
    comparisons.push(compareStructure(expectedSession.steps || [], actualSession?.steps || []));
    comparisons.push(compareNullable(expectedSession.intensity ?? null, actualSession?.intensity ?? null));
  }

  for (let i = 0; i < expected.weeks.length; i += 1) {
    comparisons.push(compareNullable(expected.weeks[i]?.week_brief ?? null, actual.weeks[i]?.week_brief ?? null));
  }

  return average(comparisons);
}

function compareNullable(expected: string | null, actual: string | null) {
  if (!expected && !actual) return 1;
  if (!expected && actual) return 0;
  return textSimilarity(expected || "", actual || "");
}

function compareStructure(expected: SessionV1["steps"], actual: SessionV1["steps"]) {
  const expectedSteps = expected || [];
  const actualSteps = actual || [];
  if (expectedSteps.length === 0 && actualSteps.length === 0) return 1;
  if (expectedSteps.length === 0 || actualSteps.length === 0) return 0;
  return ratio(
    expectedSteps.map((step) => step.type),
    actualSteps.map((step) => step.type),
  );
}

function ratio(expected: Array<string | number>, actual: Array<string | number>) {
  if (expected.length === 0 && actual.length === 0) return 1;
  if (expected.length === 0 || actual.length === 0) return 0;
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const matches = [...expectedSet].filter((value) => actualSet.has(value)).length;
  return matches / Math.max(expectedSet.size, actualSet.size);
}

function textSimilarity(expected: string, actual: string) {
  const expectedTokens = tokenize(expected);
  const actualTokens = tokenize(actual);
  if (expectedTokens.length === 0 && actualTokens.length === 0) return 1;
  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0;
  const expectedSet = new Set(expectedTokens);
  const actualSet = new Set(actualTokens);
  const overlap = [...expectedSet].filter((token) => actualSet.has(token)).length;
  return overlap / Math.max(expectedSet.size, actualSet.size);
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}
