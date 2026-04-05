import type { ProgramJsonV1, SessionV1 } from "../schemas/program-json-v1";
import {
  deriveSmartActivityTitle,
  isCoachingOrOptionalityText,
  isGenericActivityTitle,
} from "../activity-title.ts";
import {
  buildActivityDraftFromSession,
  derivePlanDayNotes,
  type PersistedActivityDraft,
} from "./v4-persistence-mapping.ts";

export type LegacyActivityDraftLike = {
  id?: string;
  planId: string;
  dayId: string;
  type: string;
  subtype: string | null;
  title: string;
  rawText: string | null;
  notes?: string | null;
  sessionInstructions?: string | null;
  distance: number | null;
  distanceUnit: "MILES" | "KM" | null;
  duration: number | null;
  paceTarget?: string | null;
  effortTarget?: string | null;
  structure?: unknown;
  tags?: unknown;
  priority: string | null;
  bailAllowed: boolean;
  mustDo: boolean;
  sessionGroupId?: string | null;
  sessionOrder?: number | null;
  coachingNote?: string | null;
  sessionFocus?: SessionV1["session_focus"] | null;
};

type EnrichLegacyDayArgs = {
  planId: string;
  dayId: string;
  sourceUnits: ProgramJsonV1["program"]["source_units"];
  weekNumber: number;
  dayOfWeek: number;
  baseActivities: LegacyActivityDraftLike[];
  program: ProgramJsonV1 | null;
};

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function findProgramSessionsForWeekDay(
  program: ProgramJsonV1 | null,
  weekNumber: number,
  dayOfWeek: number,
): SessionV1[] {
  if (!program) return [];
  const dowLabel = DOW_LABELS[dayOfWeek - 1];
  if (!dowLabel) return [];
  const week = program.weeks.find((entry) => entry.week_number === weekNumber);
  if (!week) return [];
  return (week.sessions || []).filter((session) => session.day_of_week === dowLabel);
}

export function enrichLegacyDayDraftsFromProgram({
  planId,
  dayId,
  sourceUnits,
  weekNumber,
  dayOfWeek,
  baseActivities,
  program,
}: EnrichLegacyDayArgs): {
  dayNotes: string | null;
  activities: LegacyActivityDraftLike[];
} {
  const sessions = findProgramSessionsForWeekDay(program, weekNumber, dayOfWeek);
  if (sessions.length === 0) {
    return {
      dayNotes: null,
      activities: baseActivities,
    };
  }

  const programDrafts = sessions
    .filter((session) => session.activity_type !== "Rest")
    .map((session) =>
      buildActivityDraftFromSession({
        planId,
        dayId,
        sourceUnits,
        session,
      }),
    );

  const usedProgramDrafts = new Set<number>();
  const activities = baseActivities.map((baseActivity) => {
    let bestIndex = -1;
    let bestScore = -1;

    for (let index = 0; index < programDrafts.length; index += 1) {
      if (usedProgramDrafts.has(index)) continue;
      const score = scoreLegacyToProgramMatch(baseActivity, programDrafts[index]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex === -1 || bestScore < 3) {
      return baseActivity;
    }

    usedProgramDrafts.add(bestIndex);
    return mergeLegacyActivityWithProgram(baseActivity, programDrafts[bestIndex]);
  });

  return {
    dayNotes: derivePlanDayNotes(sessions),
    activities,
  };
}

function mergeLegacyActivityWithProgram(
  baseActivity: LegacyActivityDraftLike,
  programDraft: PersistedActivityDraft,
): LegacyActivityDraftLike {
  const normalizedProgramTitle = deriveSmartActivityTitle({
    currentTitle: programDraft.title,
    activityType: programDraft.type,
    subtype: programDraft.subtype,
    sessionType: programDraft.sessionFocus,
    structure: programDraft.structure,
    sessionInstructions: programDraft.sessionInstructions,
    rawText: programDraft.rawText,
    fallbackTitle: programDraft.title,
  });
  const mergedRawText = chooseBetterSourceText(baseActivity.rawText, programDraft.rawText);
  const mergedStructure = shouldPreferProgramStructure(baseActivity.structure, programDraft.structure)
    ? (programDraft.structure ?? null)
    : (baseActivity.structure ?? null);
  const mergedSessionInstructions = shouldPreferProgramInstructions(baseActivity, programDraft)
    ? (programDraft.sessionInstructions ?? baseActivity.sessionInstructions ?? null)
    : (baseActivity.sessionInstructions ?? programDraft.sessionInstructions ?? null);
  const mergedCoachingNote = mergeCoachingNotes(baseActivity.coachingNote, programDraft.coachingNote);
  const mergedTitle = shouldPreferProgramTitle(baseActivity, normalizedProgramTitle)
    ? normalizedProgramTitle
    : baseActivity.title;

  return {
    ...baseActivity,
    type: baseActivity.type === "OTHER" ? programDraft.type : baseActivity.type,
    subtype: baseActivity.subtype && baseActivity.subtype !== "unknown"
      ? baseActivity.subtype
      : (programDraft.subtype ?? baseActivity.subtype ?? null),
    title: mergedTitle,
    rawText: mergedRawText,
    notes: chooseBetterNotes(baseActivity.notes, programDraft.notes),
    sessionInstructions: mergedSessionInstructions,
    coachingNote: mergedCoachingNote,
    structure: mergedStructure,
    sessionFocus: baseActivity.sessionFocus ?? programDraft.sessionFocus ?? null,
    bailAllowed: baseActivity.bailAllowed || programDraft.bailAllowed,
    mustDo: baseActivity.mustDo || programDraft.mustDo,
    priority: chooseStrongerPriority(baseActivity.priority, programDraft.priority),
  };
}

function scoreLegacyToProgramMatch(
  baseActivity: LegacyActivityDraftLike,
  programDraft: PersistedActivityDraft,
) {
  let score = 0;
  if (baseActivity.type === programDraft.type) score += 3;
  if (normalizeText(baseActivity.title) === normalizeText(programDraft.title)) score += 3;

  const baseRaw = normalizeText(baseActivity.rawText);
  const programRaw = normalizeText(programDraft.rawText);
  if (baseRaw && programRaw) {
    if (baseRaw === programRaw) score += 4;
    else if (baseRaw.includes(programRaw) || programRaw.includes(baseRaw)) score += 2;
  }

  if (baseActivity.subtype && programDraft.subtype && baseActivity.subtype === programDraft.subtype) {
    score += 1;
  }

  return score;
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shouldPreferProgramTitle(
  baseActivity: LegacyActivityDraftLike,
  programTitle: string,
) {
  if (!programTitle.trim()) return false;
  if (isCoachingOrOptionalityText(programTitle)) return false;
  if (!baseActivity.title?.trim()) return true;
  if (isCoachingOrOptionalityText(baseActivity.title)) return true;
  if (isGenericActivityTitle(baseActivity.title, baseActivity.type)) return true;
  if (normalizeText(baseActivity.title) === normalizeText(baseActivity.rawText)) return true;
  return false;
}

function shouldPreferProgramInstructions(
  baseActivity: LegacyActivityDraftLike,
  programDraft: PersistedActivityDraft,
) {
  const baseInstructions = normalizeInlineText(baseActivity.sessionInstructions);
  const baseRawText = normalizeInlineText(baseActivity.rawText);
  const programInstructions = normalizeInlineText(programDraft.sessionInstructions);
  if (!programInstructions) return false;
  if (!baseInstructions) return true;
  if (baseInstructions === baseRawText && programInstructions !== baseInstructions) return true;
  if (containsOrderedWorkoutSequence(programInstructions) && !containsOrderedWorkoutSequence(baseInstructions)) return true;
  if (shouldPreferProgramStructure(baseActivity.structure, programDraft.structure)) return true;
  return programInstructions.length > baseInstructions.length + 24;
}

function shouldPreferProgramStructure(baseStructure: unknown, programStructure: unknown) {
  const baseCount = countStructureSteps(baseStructure);
  const programCount = countStructureSteps(programStructure);
  if (programCount === 0) return false;
  if (baseCount === 0) return true;
  return programCount > baseCount;
}

function chooseBetterSourceText(baseText: string | null | undefined, programText: string | null | undefined) {
  const base = normalizeInlineText(baseText);
  const program = normalizeInlineText(programText);
  if (!program) return baseText ?? null;
  if (!base) return programText ?? null;
  if (program.includes(base) && program.length > base.length) return programText ?? null;
  if (containsOrderedWorkoutSequence(program) && !containsOrderedWorkoutSequence(base)) return programText ?? null;
  return baseText ?? null;
}

function chooseBetterNotes(baseNotes: string | null | undefined, programNotes: string | null | undefined) {
  const base = normalizeInlineText(baseNotes);
  const program = normalizeInlineText(programNotes);
  if (!program) return baseNotes ?? null;
  if (!base) return programNotes ?? null;
  return baseNotes ?? null;
}

function mergeCoachingNotes(baseNotes: string | null | undefined, programNotes: string | null | undefined) {
  const base = normalizeInlineText(baseNotes);
  const program = normalizeInlineText(programNotes);
  if (!program) return baseNotes ?? null;
  if (!base) return programNotes ?? null;
  if (base === program || base.includes(program)) return baseNotes ?? null;
  if (program.includes(base)) return programNotes ?? null;
  return `${baseNotes}\n\n${programNotes}`;
}

function chooseStrongerPriority(basePriority: string | null | undefined, programPriority: unknown) {
  const baseRank = priorityRank(basePriority);
  const programRank = priorityRank(programPriority);
  return programRank > baseRank ? String(programPriority) : (basePriority ?? null);
}

function priorityRank(value: unknown) {
  if (value === "KEY") return 3;
  if (value === "MEDIUM") return 2;
  if (value === "OPTIONAL") return 1;
  return 0;
}

function normalizeInlineText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsOrderedWorkoutSequence(value: string | null | undefined) {
  const text = normalizeInlineText(value).toLowerCase();
  if (!text) return false;
  return /\bfollowed by\b|\bthen\b|\bafter\b|\bbefore\b|\bplus\b|\+\s*\d|\bstrides?\b/.test(text);
}

function countStructureSteps(structure: unknown): number {
  if (!Array.isArray(structure)) return 0;
  let total = 0;
  for (const step of structure) {
    if (!step || typeof step !== "object") continue;
    total += 1;
    if (Array.isArray((step as { steps?: unknown[] }).steps)) {
      total += countStructureSteps((step as { steps?: unknown[] }).steps);
    }
  }
  return total;
}
