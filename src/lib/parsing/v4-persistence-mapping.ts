import { ActivityPriority, ActivityType, Prisma, Units } from "@prisma/client";
import { deriveSmartActivityTitle } from "../activity-title.ts";

import type { ProgramJsonV1, SessionStep, SessionV1 } from "../schemas/program-json-v1.ts";
import {
  deriveStructuredIntensityTargets,
  extractEffortTargetFromText,
  extractPaceTargetFromText,
} from "../intensity-targets.ts";

const ACTIVITY_TYPE_MAP: Record<string, ActivityType> = {
  Run: ActivityType.RUN,
  Walk: ActivityType.OTHER,
  CrossTraining: ActivityType.CROSS_TRAIN,
  Strength: ActivityType.STRENGTH,
  Rest: ActivityType.REST,
  Race: ActivityType.RUN,
  Mobility: ActivityType.MOBILITY,
  Yoga: ActivityType.YOGA,
  Hike: ActivityType.HIKE,
  Other: ActivityType.OTHER,
};

export type BuildActivityDraftArgs = {
  planId: string;
  dayId: string;
  sourceUnits: ProgramJsonV1["program"]["source_units"];
  session: SessionV1;
};

export type PersistedActivityDraft = {
  planId: string;
  dayId: string;
  type: ActivityType;
  subtype: string | null;
  title: string;
  rawText: string | null;
  notes: string | null;
  sessionInstructions: string | null;
  distance: number | null;
  distanceUnit: Units | null;
  duration: number | null;
  paceTarget: string | null;
  effortTarget: string | null;
  paceTargetMode: ReturnType<typeof deriveStructuredIntensityTargets>["paceTargetMode"];
  paceTargetBucket: ReturnType<typeof deriveStructuredIntensityTargets>["paceTargetBucket"];
  paceTargetMinSec: ReturnType<typeof deriveStructuredIntensityTargets>["paceTargetMinSec"];
  paceTargetMaxSec: ReturnType<typeof deriveStructuredIntensityTargets>["paceTargetMaxSec"];
  paceTargetUnit: ReturnType<typeof deriveStructuredIntensityTargets>["paceTargetUnit"];
  effortTargetType: ReturnType<typeof deriveStructuredIntensityTargets>["effortTargetType"];
  effortTargetMin: ReturnType<typeof deriveStructuredIntensityTargets>["effortTargetMin"];
  effortTargetMax: ReturnType<typeof deriveStructuredIntensityTargets>["effortTargetMax"];
  effortTargetZone: ReturnType<typeof deriveStructuredIntensityTargets>["effortTargetZone"];
  effortTargetBpmMin: ReturnType<typeof deriveStructuredIntensityTargets>["effortTargetBpmMin"];
  effortTargetBpmMax: ReturnType<typeof deriveStructuredIntensityTargets>["effortTargetBpmMax"];
  priority: ActivityPriority;
  mustDo: boolean;
  bailAllowed: boolean;
  structure: SessionStep[] | Prisma.NullTypes.JsonNull;
  coachingNote: string | null;
  sessionFocus: SessionV1["session_focus"] | null;
};

export function buildActivityDraftFromSession({
  planId,
  dayId,
  sourceUnits,
  session,
}: BuildActivityDraftArgs): PersistedActivityDraft {
  const { distance, distanceUnit } = resolveDistance(session, sourceUnits);
  const activityType = ACTIVITY_TYPE_MAP[session.activity_type] || ActivityType.OTHER;
  const sessionInstructions = composeSessionInstructions(session);
  const title = deriveTitle(session, activityType, sessionInstructions);
  const duration = session.duration_minutes ?? null;
  const paceTarget = extractPaceTargetFromText(session.intensity || session.raw_text || null);
  const effortTarget = session.intensity
    ? (extractEffortTargetFromText(session.intensity) || session.intensity || null)
    : extractEffortTargetFromText(session.raw_text || null);
  const structuredTargets = deriveStructuredIntensityTargets({
    paceTarget,
    effortTarget,
    fallbackUnit: distanceUnit,
  });
  const priorityLevel = derivePriorityLevel(session);
  const stepsStructure = session.steps?.length ? session.steps : null;
  const computedTotal =
    !session.distance_miles && !session.distance_km && stepsStructure
      ? computeTotalDistanceMiles(session.steps as SessionStep[])
      : null;

  return {
    planId,
    dayId,
    type: activityType,
    subtype: session.activity_type === "Race" ? "race" : null,
    title,
    rawText: session.raw_text || null,
    notes: normalizeText(session.notes),
    sessionInstructions,
    distance: computedTotal != null && distance == null ? computedTotal : distance,
    distanceUnit: computedTotal != null && distance == null ? Units.MILES : distanceUnit,
    duration,
    paceTarget,
    effortTarget,
    ...structuredTargets,
    priority: priorityLevel,
    mustDo: priorityLevel === ActivityPriority.KEY,
    bailAllowed: priorityLevel === ActivityPriority.OPTIONAL,
    structure: stepsStructure ?? Prisma.JsonNull,
    coachingNote: normalizeText(session.coaching_note),
    sessionFocus: session.session_focus ?? null,
  };
}

export function derivePlanDayNotes(sessions: SessionV1[]): string | null {
  return joinDistinctParagraphs(
    sessions.flatMap((session) => [session.raw_text, session.notes, session.coaching_note]),
  );
}

export function composeSessionInstructions(session: SessionV1): string | null {
  const stepText =
    session.steps && session.steps.length > 0
      ? formatStepsAsInstructions(session.steps as SessionStep[])
      : null;

  return joinDistinctParagraphs([
    stepText,
    session.notes,
    !stepText ? session.raw_text : null,
  ]);
}

function derivePriorityLevel(session: SessionV1) {
  if (session.priority_level === "KEY") return ActivityPriority.KEY;
  if (session.priority_level === "MEDIUM") return ActivityPriority.MEDIUM;
  if (session.priority_level === "OPTIONAL") return ActivityPriority.OPTIONAL;
  if (session.priority === true) return ActivityPriority.KEY;
  if (session.optional === true) return ActivityPriority.OPTIONAL;
  return ActivityPriority.MEDIUM;
}

function formatStepsAsInstructions(steps: SessionStep[], indent = ""): string | null {
  if (!steps || steps.length === 0) return null;
  const lines: string[] = [];
  for (const step of steps) {
    if (step.type === "repeat") {
      const inner = formatStepsAsInstructions(step.steps || [], "  ");
      lines.push(`${indent}${step.repetitions || 2}×`);
      if (inner) inner.split("\n").forEach((line) => lines.push(`  ${line}`));
      continue;
    }

    const parts: string[] = [];
    switch (step.type) {
      case "warmup":
        parts.push("Warm-up");
        break;
      case "cooldown":
        parts.push("Cool-down");
        break;
      case "interval":
        parts.push("Interval");
        break;
      case "tempo":
        parts.push("Tempo");
        break;
      case "recovery":
        parts.push("Recovery");
        break;
      case "easy":
        parts.push("Easy");
        break;
      case "distance":
        parts.push("Run");
        break;
      case "note":
        lines.push(step.description ?? "");
        continue;
    }

    if (step.distance_miles) parts.push(`${step.distance_miles} mi`);
    else if (step.distance_km) parts.push(`${step.distance_km} km`);
    if (step.duration_minutes) parts.push(`${step.duration_minutes} min`);
    if (step.pace_target) parts.push(`@ ${step.pace_target}`);
    if (step.effort) parts.push(`(${step.effort})`);
    lines.push(`${indent}${parts.join(" ")}`);
  }
  return lines.filter(Boolean).join("\n") || null;
}

function deriveTitle(
  session: SessionV1,
  activityType: ActivityType,
  sessionInstructions: string | null,
): string {
  return deriveSmartActivityTitle({
    currentTitle: session.session_role,
    activityType,
    sessionType: session.session_focus ?? null,
    structure: session.steps,
    sessionInstructions,
    rawText: session.raw_text,
    fallbackTitle: fallbackActivityTitle(activityType),
  });
}

function fallbackActivityTitle(activityType: ActivityType): string {
  switch (activityType) {
    case "RUN":
      return "Run";
    case "STRENGTH":
      return "Strength";
    case "CROSS_TRAIN":
      return "Cross Training";
    case "REST":
      return "Rest";
    case "MOBILITY":
      return "Mobility";
    case "YOGA":
      return "Yoga";
    case "HIKE":
      return "Hike";
    default:
      return "Workout";
  }
}

function resolveDistance(
  session: SessionV1,
  sourceUnits: ProgramJsonV1["program"]["source_units"],
): { distance: number | null; distanceUnit: Units | null } {
  const preferMiles = sourceUnits === "miles" || (!session.distance_km && session.distance_miles);
  const preferKm = sourceUnits === "km" || (!session.distance_miles && session.distance_km);

  if (preferMiles && session.distance_miles != null) {
    return { distance: session.distance_miles, distanceUnit: Units.MILES };
  }
  if (preferKm && session.distance_km != null) {
    return { distance: session.distance_km, distanceUnit: Units.KM };
  }
  if (session.distance_miles != null) {
    return { distance: session.distance_miles, distanceUnit: Units.MILES };
  }
  if (session.distance_km != null) {
    return { distance: session.distance_km, distanceUnit: Units.KM };
  }
  return { distance: null, distanceUnit: null };
}

function computeTotalDistanceMiles(steps: SessionStep[]): number | null {
  if (!steps?.length) return null;
  let total = 0;
  let hasAny = false;
  for (const step of steps) {
    if (step.type === "repeat") {
      const inner = computeTotalDistanceMiles(step.steps || []);
      if (inner != null) {
        total += inner * (step.repetitions || 1);
        hasAny = true;
      }
    } else {
      const distance = step.distance_miles ?? (step.distance_km ? step.distance_km / 1.60934 : null);
      if (distance != null) {
        total += distance;
        hasAny = true;
      }
    }
  }
  return hasAny ? Math.round(total * 100) / 100 : null;
}

function normalizeText(value: string | null | undefined) {
  const text = String(value || "").trim();
  return text ? text : null;
}

function joinDistinctParagraphs(values: Array<string | null | undefined>) {
  const unique = [...new Set(values.map(normalizeText).filter(Boolean))];
  return unique.length > 0 ? unique.join("\n\n") : null;
}
