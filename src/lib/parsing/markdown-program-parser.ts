import type { ProgramJsonV1, SessionV1, WeekV1 } from "../schemas/program-json-v1";

export type MarkdownProgramParseArgs = {
  markdown: string;
  planName?: string | null;
};

export type MarkdownWeekSection = {
  weekNumber: number;
  tableRows: string[];
  rawText: string;
};

export async function parseMarkdownProgram(
  args: MarkdownProgramParseArgs,
): Promise<ProgramJsonV1> {
  const sections = splitWeekSections(args.markdown);
  const weeks = sections.map((section) => {
    const week = parseWeekTables(section);
    const twm = extractWeeklyMileage(section.rawText);
    if (twm) {
      week.total_weekly_mileage_min = twm.min;
      week.total_weekly_mileage_max = twm.max;
    }
    return week;
  });
  const inferredPlanLength = extractPlanLengthFromMarkdown(args.markdown);

  return {
    program: {
      title: args.planName ?? null,
      distance_target: null,
      plan_length_weeks: inferredPlanLength ?? (weeks.length || null),
      layout_type: "sequential_table",
      source_units: null,
      intensity_rules: {},
      shared_protocols: undefined,
      training_rules: {},
      phase_rules: [],
      progression: {},
      symbol_dictionary: {},
      glossary: {},
      assumptions: [],
      program_notes: [],
    },
    weeks,
    quality_checks: {
      weeks_detected: weeks.length,
      missing_days: [],
      anomalies: [],
    },
  };
}

export function splitWeekSections(markdown: string): MarkdownWeekSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownWeekSection[] = [];

  let current: MarkdownWeekSection | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!current) return;
    current.rawText = currentLines.join("\n").trim();
    current.tableRows = currentLines.filter((line) => /^\s*\|/.test(line));
    sections.push(current);
    current = null;
    currentLines = [];
  };

  for (const line of lines) {
    const match = /^\s*##\s*Week\s+(\d+)\b/i.exec(line);
    if (match) {
      flush();
      current = {
        weekNumber: Number(match[1]),
        tableRows: [],
        rawText: "",
      };
      currentLines = [line];
      continue;
    }

    if (current) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function extractPlanLengthFromMarkdown(markdown: string): number | null {
  const patterns = [
    /(?:over|for|across|through)\s+(\d+)\s+(?:weeks?|wks?)\b/i,
    /(\d+)\s*[-\s]?week(?:s)?\b/i,
    /training\s+plan\s+for\s+(\d+)\s+weeks?\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(markdown);
    if (match) {
      const weeks = Number(match[1]);
      if (Number.isFinite(weeks) && weeks > 0) {
        return weeks;
      }
    }
  }

  return null;
}

export function parseWeekTables(section: MarkdownWeekSection): WeekV1 {
  const tableRows = section.tableRows.filter((line) => /^\s*\|/.test(line));
  const headerIndex = tableRows.findIndex((line) => /day/i.test(line) && /session/i.test(line));
  const bodyRows = headerIndex >= 0 ? tableRows.slice(headerIndex + 2) : tableRows;
  const sessions = bodyRows
    .flatMap(parseSessionRow)
    .filter((session): session is SessionV1 => session !== null);

  return {
    week_number: section.weekNumber,
    sessions,
  };
}

/**
 * Split a session text on ' + ' separators that are outside parentheses.
 * E.g. "Strength 1 (Circuit 1 — weeks 1–8; see section) + Easy run"
 * → ["Strength 1 (Circuit 1 — weeks 1–8; see section)", "Easy run"]
 *
 * A '+' inside parentheses is NOT a compound separator (it is part of the
 * description), so we track parenthesis depth and only split at depth 0.
 *
 * Returns the original text as a single-element array if no top-level ' + '
 * separators are found, OR if all candidate parts resolve to the same
 * activity type (e.g. "WU 1 mile + Tempo 3 miles + CD 1 mile" is one Run
 * session, not three separate activities).
 *
 * The heterogeneous-type check handles all single-session cases:
 *   - "WU 1 mile + Tempo 3 miles + CD 1 mile" → all Run → keep as one session
 *   - "Hills: WU 10 min | 4 x 90 sec up hill | CD 10 min" → no ' + ' at depth 0 → single part → keep as one
 *   - "Incline Treadmill: WU...CD...; + Strength 2 (...)" → CrossTraining + Strength → split
 */
export function splitCompoundSessionText(text: string): string[] {

  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (depth === 0 && ch === "+" && text[i - 1] === " " && text[i + 1] === " ") {
      // Found ' + ' at depth 0 — candidate compound separator
      const part = text.slice(start, i - 1).trim();
      if (part) parts.push(part);
      start = i + 2; // skip past '+ '
    }
  }

  const last = text.slice(start).trim();
  if (last) parts.push(last);

  if (parts.length <= 1) return [text];

  // Only treat as a genuine split when the parts resolve to heterogeneous
  // activity types. "WU 1 mile + Tempo 3 miles + CD 1 mile" → all Run →
  // keep as one session. "Strength 1 (...) + Easy run" → Strength + Run →
  // split into two separate activities.
  const types = parts.map((p) => inferActivityType(normalizeSessionSemanticText(p)));
  const allSameType = types.every((t) => t === types[0]);
  if (allSameType) return [text];

  return parts;
}

function parseSessionRow(row: string): Array<SessionV1 | null> {
  const cells = splitMarkdownRow(row);
  if (cells.length < 2) return [null];

  const dayCode = normalizeDayCode(cells[0]);
  if (!dayCode) return [null];

  const fullRawText = cells[1]?.trim() || "";
  if (!fullRawText || /^[-—]+$/.test(fullRawText)) return [null];

  const distanceText = cells[2]?.trim() || "";
  const durationText = cells[3]?.trim() || "";

  // Split compound sessions joined by ' + ' outside parentheses only when
  // the parts have different activity types (i.e. genuinely different activities).
  const parts = splitCompoundSessionText(fullRawText);

  if (parts.length === 1) {
    // Fast path — no compound split needed
    return [buildSession(dayCode, fullRawText, distanceText, durationText)];
  }

  // Compound day: build one session per part. Distance/duration from the row's
  // dedicated columns belong to the cardio part (Run, Walk, Hike, CrossTraining),
  // not to Strength/Rest/Yoga. Find the first cardio part index; fall back to 0
  // only when every part is non-cardio (very unusual).
  const CARDIO_TYPES = new Set<SessionV1["activity_type"]>(["Run", "Walk", "Hike", "CrossTraining", "Race"]);
  const partTypes = parts.map((p) => inferActivityType(normalizeSessionSemanticText(p)));
  const cardioIdx = partTypes.findIndex((t) => CARDIO_TYPES.has(t));
  const distanceOwnerIdx = cardioIdx >= 0 ? cardioIdx : 0;

  return parts.map((part, idx) => {
    const rowDistance = idx === distanceOwnerIdx ? distanceText : "";
    const rowDuration = idx === distanceOwnerIdx ? durationText : "";
    return buildSession(dayCode, part, rowDistance, rowDuration);
  });
}

function buildSession(
  dayCode: SessionV1["day_of_week"],
  rawText: string,
  distanceText: string,
  durationText: string,
): SessionV1 {
  const semanticText = normalizeSessionSemanticText(rawText);

  const session: SessionV1 = {
    day_of_week: dayCode,
    session_role: inferSessionRole(semanticText),
    activity_type: inferActivityType(semanticText),
    session_focus: inferSessionFocus(semanticText),
    priority: hasPriorityMarker(rawText),
    optional: hasBailMarker(rawText),
    priority_level: hasPriorityMarker(rawText) ? "KEY" : undefined,
    raw_text: rawText,
    steps: [],
    optional_alternatives: [],
  };

  const distance = parseDistanceValue(distanceText || semanticText);
  if (distance?.unit === "miles") {
    session.distance_miles = distance.value;
  } else if (distance?.unit === "km") {
    session.distance_km = distance.value;
  }

  const duration = parseDurationValue(durationText || semanticText);
  if (duration?.kind === "exact") {
    session.duration_minutes = duration.value;
  } else if (duration?.kind === "range") {
    session.duration_min_minutes = duration.min;
    session.duration_max_minutes = duration.max;
  }

  return session;
}

function splitMarkdownRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeDayCode(label: string): SessionV1["day_of_week"] | null {
  const normalized = label.trim().toLowerCase();
  const dayMap: Record<string, SessionV1["day_of_week"]> = {
    monday: "Mon",
    mon: "Mon",
    tuesday: "Tue",
    tue: "Tue",
    wednesday: "Wed",
    wed: "Wed",
    thursday: "Thu",
    thu: "Thu",
    friday: "Fri",
    fri: "Fri",
    saturday: "Sat",
    sat: "Sat",
    sunday: "Sun",
    sun: "Sun",
  };

  return dayMap[normalized] ?? null;
}

// Keywords that indicate a strength/conditioning activity when found anywhere in
// the text (including inside parentheses describing exercise details).
// High-confidence strength exercise keywords — chosen to avoid false positives
// on common running text (e.g. "row" → "narrow/tomorrow", "press" → "express").
// Match as substrings against the lowercased full text (including inside parens).
const STRENGTH_EXERCISE_KEYWORDS = [
  "step up",
  "step-up",
  "lunge",
  "squat",
  "push-up",
  "pushup",
  "pull-up",
  "pullup",
  "chin-up",
  "chinup",
  "deadlift",
  "plank",
  "crunch",
  "sit-up",
  "situp",
  "burpee",
];

function inferActivityType(rawText: string): SessionV1["activity_type"] {
  const lower = rawText.toLowerCase();
  if (lower.includes("rest")) return "Rest";
  if (lower.includes("strength") || lower.includes("mobility") || lower.includes("core")) return "Strength";
  // Detect strength activities by exercise detail keywords (e.g. "LRL (100 step ups…)")
  if (STRENGTH_EXERCISE_KEYWORDS.some((kw) => lower.includes(kw))) return "Strength";
  if (lower.includes("crosstrain") || lower.includes("cross train")) return "CrossTraining";
  if (lower.includes("race")) return "Race";
  if (lower.includes("walk")) return "Walk";
  if (lower.includes("yoga")) return "Yoga";
  if (lower.includes("hike")) return "Hike";
  return "Run";
}

function inferSessionRole(rawText: string): string | undefined {
  const lower = rawText.toLowerCase();
  if (lower.includes("long run")) return "long_run";
  if (lower.includes("tempo")) return "tempo";
  if (lower.includes("hill")) return "hill";
  if (lower.includes("interval")) return "interval";
  if (lower.includes("race")) return "race";
  if (lower.includes("strength")) return "strength";
  if (lower.includes("rest")) return "rest";
  if (lower.includes("crosstrain") || lower.includes("cross train")) return "cross_train";
  if (lower.includes("easy")) return "easy";
  return undefined;
}

function inferSessionFocus(rawText: string): SessionV1["session_focus"] {
  const lower = rawText.toLowerCase();
  if (lower.includes("long run")) return "long_run";
  if (lower.includes("tempo")) return "tempo";
  if (lower.includes("interval") || lower.includes("hill")) return "threshold";
  if (lower.includes("race")) return "race_sim";
  if (lower.includes("strength") || lower.includes("mobility") || lower.includes("core")) return "strength";
  if (lower.includes("rest") || lower.includes("easy") || lower.includes("recovery") || lower.includes("crosstrain") || lower.includes("cross train")) return "recovery";
  return "other";
}

function hasPriorityMarker(rawText: string): boolean {
  return /[⭐★]/u.test(rawText) || /key session/i.test(rawText);
}

function hasBailMarker(rawText: string): boolean {
  return /♥/u.test(rawText) || /bail if necessary/i.test(rawText);
}

function normalizeSessionSemanticText(rawText: string): string {
  return rawText
    .replace(/[⭐★♥]/gu, "")
    .replace(/\bkey session\b\s*[—-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDistanceValue(text: string): { value: number; unit: "miles" | "km" } | null {
  const normalized = text.trim();
  if (!normalized || /^[-—]+$/.test(normalized)) return null;

  const kmMatch = /(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometres?|k)\b/i.exec(normalized);
  if (kmMatch) {
    return { value: Number(kmMatch[1]), unit: "km" };
  }

  const mileMatch = /(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i.exec(normalized);
  if (mileMatch) {
    return { value: Number(mileMatch[1]), unit: "miles" };
  }

  return null;
}

function parseDurationValue(
  text: string,
): { kind: "exact"; value: number } | { kind: "range"; min: number; max: number } | null {
  const normalized = text.trim();
  if (!normalized || /^[-—]+$/.test(normalized)) return null;

  const rangeMatch = /(\d+)\s*[–-]\s*(\d+)\s*(?:min|mins|minutes?)\b/i.exec(normalized);
  if (rangeMatch) {
    return {
      kind: "range",
      min: Number(rangeMatch[1]),
      max: Number(rangeMatch[2]),
    };
  }

  const exactMatch = /(\d+)\s*(?:min|mins|minutes?)\b/i.exec(normalized);
  if (exactMatch) {
    return { kind: "exact", value: Number(exactMatch[1]) };
  }

  return null;
}

function extractWeeklyMileage(rawText: string): { min: number; max: number } | null {
  const match = /TWM:\s*([\d.]+)(?:\s*[–-]\s*([\d.]+))?\s*miles?/i.exec(rawText);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

export default {
  parseMarkdownProgram,
  splitWeekSections,
  parseWeekTables,
  splitCompoundSessionText,
};
