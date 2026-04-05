import type { ProgramJsonV1, SessionV1, WeekV1 } from "../schemas/program-json-v1";

export type UploadParserKey = "vision" | "v4" | "v5" | "legacy";

export type UploadDocumentSignals = {
  weekMarkers: number;
  glossaryDensity: number;
  tableDensity: number;
  ocrNoiseDensity: number;
  lineBreakDensity: number;
  symbolicDensity: number;
  multilingualHints: boolean;
};

export type UploadParserQuality = {
  score: number;
  weekCount?: number;
  dayCoverage?: number;
  notesCoverage?: number;
  structureCoverage?: number;
  sessionCount?: number;
};

export type UploadParserRun =
  | {
      parser: UploadParserKey;
      kind: "program";
      viable: boolean;
      quality: UploadParserQuality;
      data: ProgramJsonV1 | null;
      warning: string | null;
      promptName?: string | null;
    }
  | {
      parser: UploadParserKey;
      kind: "legacy";
      viable: boolean;
      quality: UploadParserQuality;
      data: Record<string, unknown> | null;
      warning: string | null;
      promptName?: string | null;
    };

export type UploadOrchestrationResult = {
  selectedBaseParser: UploadParserKey;
  finalParser: UploadParserKey;
  usedFallback: boolean;
  usedEnrichers: UploadParserKey[];
  candidateRuns: UploadParserRun[];
  resultKind: "program" | "legacy" | "none";
  program: ProgramJsonV1 | null;
  legacy: Record<string, unknown> | null;
  promptName: string | null;
};

type OrchestrationOptions = {
  signals: UploadDocumentSignals;
  budgetMs: number;
  candidates: UploadParserKey[];
  runCandidate: (parser: UploadParserKey) => Promise<UploadParserRun>;
  seedRuns?: UploadParserRun[];
  minimumViableScore?: number;
  enrichBudgetFloorMs?: number;
};

const SESSION_DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function deriveUploadDocumentSignals(fullText: string): UploadDocumentSignals {
  const text = String(fullText || "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const wordCount = Math.max(1, text.split(/\s+/).filter(Boolean).length);
  const weekMarkers = (text.match(/\b(?:week|wk|woche|semaine|semana|sem)\s*[:#-]?\s*\d{1,2}\b/gi) || []).length;
  const glossaryMentions = (text.match(/\b(?:glossary|legend|abbreviations?|key)\b/gi) || []).length;
  const tableWords = (text.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|twm)\b/gi) || []).length;
  const noisyTokens = (text.match(/[|¦]|[_]{2,}|[^\x00-\x7F]{2,}|[A-Z0-9]{8,}/g) || []).length;
  const symbolicTokens = (text.match(/[★♥→]|(?:\b(?:lr|lrl|xt|wu|cd|mp|rp|hm|z[1-5]|rpe)\b)/gi) || []).length;
  const multilingualHints = /\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(text);

  return {
    weekMarkers,
    glossaryDensity: glossaryMentions / wordCount,
    tableDensity: tableWords / wordCount,
    ocrNoiseDensity: noisyTokens / wordCount,
    lineBreakDensity: lines.length / wordCount,
    symbolicDensity: symbolicTokens / wordCount,
    multilingualHints,
  };
}

export function chooseBaseParser(
  signals: UploadDocumentSignals,
  candidates: UploadParserKey[],
): UploadParserKey {
  const available = new Set(candidates);

  if (available.has("legacy")) {
    const stronglyTabular =
      signals.tableDensity >= 0.08 &&
      signals.weekMarkers >= 8 &&
      signals.ocrNoiseDensity <= 0.08;
    if (stronglyTabular) return "legacy";
  }

  if (available.has("vision")) {
    const likelyVisual =
      signals.ocrNoiseDensity >= 0.14 ||
      (signals.tableDensity < 0.04 && signals.weekMarkers <= 6) ||
      signals.multilingualHints;
    if (likelyVisual) return "vision";
  }

  if (available.has("v5")) {
    const benefitsFromContext =
      signals.symbolicDensity >= 0.01 ||
      signals.glossaryDensity >= 0.002;
    if (benefitsFromContext) return "v5";
  }

  if (available.has("v4")) return "v4";
  if (available.has("vision")) return "vision";
  if (available.has("legacy")) return "legacy";
  if (available.has("v5")) return "v5";

  throw new Error("No parser candidates available for upload orchestration");
}

export function scoreProgramJsonForTables(program: ProgramJsonV1 | null): UploadParserQuality {
  if (!program) {
    return {
      score: 0,
      weekCount: 0,
      dayCoverage: 0,
      notesCoverage: 0,
      structureCoverage: 0,
      sessionCount: 0,
    };
  }

  const weekCount = program.weeks.length;
  const sessions = program.weeks.flatMap((week) => week.sessions || []);
  const sessionCount = sessions.length;
  const sessionsWithDays = sessions.filter((session) => session.day_of_week && SESSION_DAY_KEYS.includes(session.day_of_week)).length;
  const sessionsWithNotes = sessions.filter((session) =>
    Boolean(session.notes?.trim()) || Boolean(session.coaching_note?.trim()) || Boolean(weekBriefForSession(program.weeks, session)),
  ).length;
  const sessionsWithStructure = sessions.filter((session) => (session.steps || []).length > 0).length;
  const dayCoverage = sessionCount > 0 ? sessionsWithDays / sessionCount : 0;
  const notesCoverage = sessionCount > 0 ? sessionsWithNotes / sessionCount : 0;
  const structureCoverage = sessionCount > 0 ? sessionsWithStructure / sessionCount : 0;

  let score = 0;
  if (weekCount > 0) score += 0.35;
  score += Math.min(1, dayCoverage) * 0.35;
  score += Math.min(1, notesCoverage) * 0.15;
  score += Math.min(1, structureCoverage) * 0.15;

  return {
    score: Number(Math.min(1, Math.max(0, score)).toFixed(3)) * 100,
    weekCount,
    dayCoverage: Number(dayCoverage.toFixed(3)),
    notesCoverage: Number(notesCoverage.toFixed(3)),
    structureCoverage: Number(structureCoverage.toFixed(3)),
    sessionCount,
  };
}

export function mergeProgramsWithOwnership(
  base: ProgramJsonV1,
  enrichers: Array<{ parser: UploadParserKey; data: ProgramJsonV1; quality: Pick<UploadParserQuality, "score"> }>,
): ProgramJsonV1 {
  const merged: ProgramJsonV1 = structuredClone(base);

  for (const enricher of enrichers) {
    const enrichedWeeks = [...enricher.data.weeks].sort((a, b) => a.week_number - b.week_number);
    const baseWeeks = [...merged.weeks].sort((a, b) => a.week_number - b.week_number);

    for (let index = 0; index < enrichedWeeks.length; index += 1) {
      const enrichedWeek = enrichedWeeks[index];
      const targetWeek =
        merged.weeks.find((week) => week.week_number === enrichedWeek.week_number) ??
        baseWeeks[index] ??
        null;
      if (!targetWeek) continue;

      if (!targetWeek.week_brief && enrichedWeek.week_brief) {
        targetWeek.week_brief = enrichedWeek.week_brief;
      }

      const sessionPairs = zipSessionsByRawText(targetWeek.sessions, enrichedWeek.sessions);
      for (const [baseSession, enrichedSession] of sessionPairs) {
        mergeSessionWithOwnership(baseSession, enrichedSession);
      }
    }

    merged.program.glossary = {
      ...enricher.data.program.glossary,
      ...merged.program.glossary,
    };
    merged.program.symbol_dictionary = {
      ...enricher.data.program.symbol_dictionary,
      ...merged.program.symbol_dictionary,
    };
    merged.program.program_notes = dedupeStrings([
      ...merged.program.program_notes,
      ...enricher.data.program.program_notes,
    ]);
  }

  return merged;
}

export async function orchestrateUploadParsing(
  options: OrchestrationOptions,
): Promise<UploadOrchestrationResult> {
  const {
    signals,
    budgetMs,
    candidates,
    runCandidate,
    seedRuns = [],
    minimumViableScore = 45,
    enrichBudgetFloorMs = 45_000,
  } = options;
  const selectedBaseParser = chooseBaseParser(signals, candidates);
  const candidateRuns: UploadParserRun[] = [...seedRuns];
  const usedEnrichers: UploadParserKey[] = [];
  let usedFallback = false;
  const startedAt = Date.now();

  const execute = async (parser: UploadParserKey) => {
    const existing = candidateRuns.find((run) => run.parser === parser);
    if (existing) return existing;
    const run = await runCandidate(parser);
    candidateRuns.push(run);
    return run;
  };

  const baseRun = await execute(selectedBaseParser);
  let finalRun = baseRun;
  let mergedProgram = baseRun.kind === "program" ? baseRun.data : null;

  if (
    baseRun.kind === "legacy" &&
    budgetMs - (Date.now() - startedAt) >= enrichBudgetFloorMs
  ) {
    const programCandidates = candidates.filter(
      (candidate) =>
        candidate !== "legacy" &&
        !candidateRuns.some((run) => run.parser === candidate),
    );

    let bestProgramRun: Extract<UploadParserRun, { kind: "program" }> | null = null;
    for (const candidate of programCandidates) {
      const run = await execute(candidate);
      if (run.kind !== "program" || !run.viable || !run.data) continue;
      if (run.quality.score < minimumViableScore) continue;
      if (!bestProgramRun || run.quality.score > bestProgramRun.quality.score) {
        bestProgramRun = run;
      }
    }

    if (bestProgramRun) {
      finalRun = bestProgramRun;
      mergedProgram = bestProgramRun.data;
    }
  }

  if (baseRun.kind === "legacy") {
    const seededProgramRun = candidateRuns
      .filter((run): run is Extract<UploadParserRun, { kind: "program" }> => run.kind === "program" && Boolean(run.data))
      .filter((run) => run.viable && run.quality.score >= minimumViableScore)
      .sort((left, right) => right.quality.score - left.quality.score)[0] ?? null;

    if (seededProgramRun) {
      finalRun = seededProgramRun;
      mergedProgram = seededProgramRun.data;
    }
  }

  if (
    baseRun.kind === "program" &&
    baseRun.viable &&
    baseRun.data &&
    budgetMs - (Date.now() - startedAt) >= enrichBudgetFloorMs
  ) {
    const enrichers = candidates.filter(
      (candidate) =>
        candidate !== selectedBaseParser &&
        candidate !== "legacy" &&
        !candidateRuns.some((run) => run.parser === candidate),
    );

    const successfulEnrichers: Array<{ parser: UploadParserKey; data: ProgramJsonV1; quality: Pick<UploadParserQuality, "score"> }> = [];
    for (const candidate of enrichers) {
      const run = await execute(candidate);
      if (run.kind !== "program" || !run.viable || !run.data) continue;
      if (run.quality.score + 10 < baseRun.quality.score) continue;
      successfulEnrichers.push({ parser: candidate, data: run.data, quality: run.quality });
      usedEnrichers.push(candidate);
    }

    if (successfulEnrichers.length > 0) {
      mergedProgram = mergeProgramsWithOwnership(baseRun.data, successfulEnrichers);
      finalRun = {
        ...baseRun,
        data: mergedProgram,
        quality: scoreProgramJsonForTables(mergedProgram),
      };
    }
  }

  const finalScore = finalRun.quality.score;
  const finalViable = finalRun.viable && finalScore >= minimumViableScore && finalRun.data !== null;
  if (!finalViable) {
    const fallbackParser = candidates.includes("legacy") ? "legacy" : null;
    if (fallbackParser && !candidateRuns.some((run) => run.parser === fallbackParser)) {
      const fallbackRun = await execute(fallbackParser);
      if (fallbackRun.viable && fallbackRun.data) {
        finalRun = fallbackRun;
        usedFallback = true;
        mergedProgram = null;
      }
    }
  }

  return {
    selectedBaseParser,
    finalParser: finalRun.parser,
    usedFallback,
    usedEnrichers,
    candidateRuns,
    resultKind: finalRun.kind,
    program: finalRun.kind === "program" ? (mergedProgram ?? finalRun.data) : null,
    legacy: finalRun.kind === "legacy" ? finalRun.data : null,
    promptName: finalRun.promptName ?? null,
  };
}

function weekBriefForSession(weeks: WeekV1[], target: SessionV1) {
  for (const week of weeks) {
    if (week.sessions.includes(target)) return week.week_brief ?? null;
  }
  return null;
}

function zipSessionsByRawText(baseSessions: SessionV1[], enrichedSessions: SessionV1[]) {
  const pairs: Array<[SessionV1, SessionV1]> = [];
  const used = new Set<number>();

  for (const baseSession of baseSessions) {
    const baseRaw = normalizeToken(baseSession.raw_text);
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < enrichedSessions.length; i += 1) {
      if (used.has(i)) continue;
      const enriched = enrichedSessions[i];
      let score = 0;
      if (normalizeToken(enriched.raw_text) === baseRaw) score += 6;
      if (enriched.activity_type === baseSession.activity_type) score += 3;
      if (enriched.day_of_week === baseSession.day_of_week) score += 2;
      if ((enriched.session_role || "") === (baseSession.session_role || "")) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx);
      pairs.push([baseSession, enrichedSessions[bestIdx]]);
    }
  }

  return pairs;
}

function mergeSessionWithOwnership(baseSession: SessionV1, enrichedSession: SessionV1) {
  if (!baseSession.session_role && enrichedSession.session_role) {
    baseSession.session_role = enrichedSession.session_role;
  }
  if (shouldPreferText(baseSession.notes, enrichedSession.notes)) {
    baseSession.notes = enrichedSession.notes;
  }
  if (shouldPreferText(baseSession.coaching_note, enrichedSession.coaching_note)) {
    baseSession.coaching_note = enrichedSession.coaching_note;
  }
  if (!baseSession.session_focus && enrichedSession.session_focus) {
    baseSession.session_focus = enrichedSession.session_focus;
  }
  if (!baseSession.intensity && enrichedSession.intensity) {
    baseSession.intensity = enrichedSession.intensity;
  }
  if ((!baseSession.steps || baseSession.steps.length === 0) && enrichedSession.steps && enrichedSession.steps.length > 0) {
    baseSession.steps = enrichedSession.steps;
  }
  if (
    (!baseSession.optional_alternatives || baseSession.optional_alternatives.length === 0) &&
    enrichedSession.optional_alternatives &&
    enrichedSession.optional_alternatives.length > 0
  ) {
    baseSession.optional_alternatives = enrichedSession.optional_alternatives;
  }
  if (baseSession.notes == null && enrichedSession.notes) {
    baseSession.notes = enrichedSession.notes;
  }
  if (baseSession.quality_distance_km == null && enrichedSession.quality_distance_km != null) {
    baseSession.quality_distance_km = enrichedSession.quality_distance_km;
  }
  if (baseSession.quality_distance_miles == null && enrichedSession.quality_distance_miles != null) {
    baseSession.quality_distance_miles = enrichedSession.quality_distance_miles;
  }
  if (baseSession.total_distance_km == null && enrichedSession.total_distance_km != null) {
    baseSession.total_distance_km = enrichedSession.total_distance_km;
  }
  if (baseSession.total_distance_miles == null && enrichedSession.total_distance_miles != null) {
    baseSession.total_distance_miles = enrichedSession.total_distance_miles;
  }
}

function shouldPreferText(base: string | null | undefined, enriched: string | null | undefined) {
  const baseText = normalizeToken(base);
  const enrichedText = normalizeToken(enriched);
  if (!enrichedText) return false;
  if (!baseText) return true;
  return enrichedText.length > baseText.length + 8;
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
