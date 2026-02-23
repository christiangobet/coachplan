import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseWeekWithAI, maybeRunParserV4 } from '@/lib/ai-plan-parser';
import { extractPlanGuide } from '@/lib/ai-guide-extractor';
import { extractPdfText } from '@/lib/pdf/extract-text';
import { FLAGS } from '@/lib/feature-flags';
import { populatePlanFromV4 } from '@/lib/parsing/v4-to-plan';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';
import { canonicalizeTableLabel, extractWeekNumber, normalizePlanText } from '@/lib/plan-parser-i18n.mjs';
import { hasConfiguredAiProvider } from '@/lib/openai';
import { buildProgramDocumentProfile, type ProgramDocumentProfile } from '@/lib/plan-document-profile';
import {
  deriveStructuredIntensityTargets,
  extractEffortTargetFromText,
  extractPaceTargetFromText,
  hasConcretePaceValue,
  inferSymbolicPaceBucketFromText,
  paceBucketLabel,
  type PaceBucket
} from '@/lib/intensity-targets';
import { normalizePaceForStorage } from '@/lib/unit-display';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathToFileURL } from 'url';

export const runtime = 'nodejs';
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TABLE_LABELS = ['WEEK', ...DAY_LABELS];
const ENABLE_AI_WEEK_PARSE = process.env.ENABLE_AI_WEEK_PARSE === 'true' && hasConfiguredAiProvider();

function parseTimeoutMs(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000) return fallback;
  return Math.floor(parsed);
}

function parseBoundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const UPLOAD_PARSE_TIMEOUT_MS = parseTimeoutMs(process.env.UPLOAD_PARSE_TIMEOUT_MS, 120000);
const AI_WEEK_PARSE_TIMEOUT_MS = parseTimeoutMs(process.env.AI_WEEK_PARSE_TIMEOUT_MS, 8000);
const AI_WEEK_PARSE_TOTAL_BUDGET_MS = parseTimeoutMs(process.env.AI_WEEK_PARSE_TOTAL_BUDGET_MS, 30000);
const AI_WEEK_PARSE_MODEL = process.env.AI_WEEK_PARSE_MODEL?.trim() || undefined;
const AI_WEEK_PARSE_MAX_DAYS = Math.floor(
  parseBoundedNumber(process.env.AI_WEEK_PARSE_MAX_DAYS, 3, 1, DAY_KEYS.length)
);
const PARSE_MIN_QUALITY_SCORE = parseBoundedNumber(process.env.PARSE_MIN_QUALITY_SCORE, 30, 0, 100);
const PARSE_MIN_DAY_COVERAGE = parseBoundedNumber(process.env.PARSE_MIN_DAY_COVERAGE, 0.12, 0, 1);

const RUN_SUBTYPES = new Set([
  'tempo',
  'interval',
  'hills',
  'hill-pyramid',
  'incline-treadmill',
  'progression',
  'trail-run',
  'recovery',
  'easy-run',
  'training-race',
  'race',
  'time-trial',
  'fast-finish',
  'lrl',
  'unknown'
]);

const SUBTYPE_TITLES: Record<string, string> = {
  'lrl': 'Long Run',
  'easy-run': 'Easy Run',
  'tempo': 'Tempo Run',
  'interval': 'Interval Session',
  'hills': 'Hill Workout',
  'hill-pyramid': 'Hill Pyramid',
  'incline-treadmill': 'Incline Treadmill',
  'progression': 'Progression Run',
  'trail-run': 'Trail Run',
  'recovery': 'Recovery Run',
  'fast-finish': 'Fast Finish',
  'training-race': 'Training Race',
  'time-trial': 'Time Trial',
  'race': 'Race',
  'strength': 'Strength',
  'cross-training': 'Cross Training',
  'mobility': 'Mobility',
  'yoga': 'Yoga',
  'hike': 'Hike',
};

function titleCase(text: string) {
  return text
    .replace(/-/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

function planNameFromFilename(filename: string) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const normalized = withoutExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'Uploaded Plan';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type DistanceParseResult = {
  distance: number | null;
  distanceUnit: 'MILES' | 'KM' | null;
};

type UnitPreference = 'MILES' | 'KM';

type ParsedDayEntry = {
  raw?: string | null;
  segments_parsed?: Array<{ type?: string | null }> | null;
};

type ParsedWeekEntry = {
  week_number?: number | null;
  days?: Partial<Record<string, ParsedDayEntry | null>> | null;
};

type ParseQuality = {
  score: number;
  weekCount: number;
  dayCoverage: number;
  populatedDays: number;
  totalDaySlots: number;
  avgCharsPerPopulatedDay: number;
  unknownSegmentRatio: number;
  consecutiveWeekCoverage: number;
};

type ParseCandidate = {
  parser: 'python' | 'node' | 'node-text';
  parsed: ParsedPlanOutput;
  quality: ParseQuality;
};

type ParsedPlanOutput = Record<string, unknown> & {
  weeks: ParsedWeekEntry[];
  glossary?: { note?: string | null } & Record<string, unknown>;
  program_profile?: ProgramDocumentProfile;
  parser?: string;
  parse_debug?: Record<string, unknown>;
  parse_meta?: {
    selectedParser: string;
    quality: ParseQuality;
    selectedDiagnostics?: Record<string, unknown> | null;
    candidates: Array<{
      parser: string;
      quality: ParseQuality;
      diagnostics?: Record<string, unknown> | null;
    }>;
  };
};

function buildProfileFromParsed(planName: string, parsed: ParsedPlanOutput): ProgramDocumentProfile {
  return buildProgramDocumentProfile({
    planName,
    weeks: Array.isArray(parsed.weeks) ? parsed.weeks : []
  });
}

function toParsedDayEntry(value: unknown): ParsedDayEntry {
  if (!value || typeof value !== 'object') return {};
  const raw = typeof (value as { raw?: unknown }).raw === 'string' ? (value as { raw: string }).raw : null;
  const segmentsCandidate = (value as { segments_parsed?: unknown }).segments_parsed;
  const segments = Array.isArray(segmentsCandidate)
    ? segmentsCandidate
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({ type: typeof (entry as { type?: unknown }).type === 'string' ? (entry as { type: string }).type : null }))
    : null;
  return { raw, segments_parsed: segments };
}

function scoreParsedResult(parsed: unknown): ParseQuality {
  const weeks = Array.isArray((parsed as { weeks?: unknown })?.weeks)
    ? ((parsed as { weeks: unknown[] }).weeks as ParsedWeekEntry[])
    : [];

  const weekCount = weeks.length;
  const totalDaySlots = weekCount * DAY_KEYS.length;
  let populatedDays = 0;
  let charCount = 0;
  let unknownSegments = 0;
  let totalSegments = 0;
  const weekNumbers: number[] = [];

  for (let i = 0; i < weeks.length; i += 1) {
    const week = weeks[i];
    const weekNumber = typeof week?.week_number === 'number' && Number.isFinite(week.week_number)
      ? week.week_number
      : i + 1;
    weekNumbers.push(weekNumber);

    const days = week?.days && typeof week.days === 'object' ? week.days : {};
    for (const day of DAY_KEYS) {
      const entry = toParsedDayEntry((days as Record<string, unknown>)[day]);
      const raw = String(entry.raw || '').trim();
      if (raw) {
        populatedDays += 1;
        charCount += raw.length;
      }
      const segments = Array.isArray(entry.segments_parsed) ? entry.segments_parsed : [];
      totalSegments += segments.length;
      unknownSegments += segments.filter((segment) => segment?.type === 'unknown').length;
    }
  }

  const dayCoverage = totalDaySlots > 0 ? populatedDays / totalDaySlots : 0;
  const avgCharsPerPopulatedDay = populatedDays > 0 ? charCount / populatedDays : 0;
  const unknownSegmentRatio = totalSegments > 0 ? unknownSegments / totalSegments : 0;

  const uniqueWeeks = [...new Set(weekNumbers)].sort((a, b) => a - b);
  let longestRun = uniqueWeeks.length > 0 ? 1 : 0;
  let currentRun = uniqueWeeks.length > 0 ? 1 : 0;
  for (let i = 1; i < uniqueWeeks.length; i += 1) {
    if (uniqueWeeks[i] === uniqueWeeks[i - 1] + 1) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  const consecutiveWeekCoverage = uniqueWeeks.length > 0 ? longestRun / uniqueWeeks.length : 0;

  let score = 0;
  if (weekCount > 0) score += 20;
  if (weekCount >= 2) score += 10;
  if (weekCount >= 4) score += 5;
  if (weekCount >= 8) score += 5;
  score += Math.round(Math.min(1, dayCoverage) * 40);

  if (avgCharsPerPopulatedDay >= 20) score += 10;
  else if (avgCharsPerPopulatedDay >= 8) score += 8;
  else if (avgCharsPerPopulatedDay >= 3) score += 5;
  else if (avgCharsPerPopulatedDay > 0) score += 2;

  score += Math.round(Math.min(1, consecutiveWeekCoverage) * 10);
  if (unknownSegmentRatio > 0.6) score -= 6;
  else if (unknownSegmentRatio > 0.35) score -= 3;
  if (weekCount === 0 || dayCoverage === 0) score = 0;

  return {
    score: Math.min(100, Math.max(0, score)),
    weekCount,
    dayCoverage,
    populatedDays,
    totalDaySlots,
    avgCharsPerPopulatedDay: Number(avgCharsPerPopulatedDay.toFixed(2)),
    unknownSegmentRatio: Number(unknownSegmentRatio.toFixed(3)),
    consecutiveWeekCoverage: Number(consecutiveWeekCoverage.toFixed(3))
  };
}

function selectBestParseCandidate(candidates: ParseCandidate[]) {
  const parserPriority: Record<ParseCandidate['parser'], number> = {
    python: 0,
    node: 1,
    'node-text': 2
  };
  const sorted = [...candidates].sort((a, b) => {
    if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
    if (b.quality.dayCoverage !== a.quality.dayCoverage) return b.quality.dayCoverage - a.quality.dayCoverage;
    if (b.quality.weekCount !== a.quality.weekCount) return b.quality.weekCount - a.quality.weekCount;
    if (a.parser === b.parser) return 0;
    return parserPriority[a.parser] - parserPriority[b.parser];
  });
  return sorted[0];
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function asUpperDistanceUnit(token: unknown): 'MILES' | 'KM' | 'M' | null {
  if (!token || typeof token !== 'string') return null;
  const unit = token.trim().toLowerCase();
  if (unit === 'mile' || unit === 'miles' || unit === 'mi') return 'MILES';
  if (unit === 'km' || unit === 'kms' || unit === 'kilometer' || unit === 'kilometre' || unit === 'kilometers' || unit === 'kilometres') return 'KM';
  if (unit === 'm' || unit === 'meter' || unit === 'metre' || unit === 'meters' || unit === 'metres') return 'M';
  return null;
}

function hasMetersNotation(text: string) {
  const t = normalizePlanText(text).toLowerCase();
  if (/\d+(?:\.\d+)?\s*(?:meters?|metres?)\b/.test(t)) return true;
  if (/\b(?:reps?|strides?|interval)\b/.test(t) && /\d{2,4}\s*m\b/.test(t)) return true;
  return /\d{3,4}\s*m\b/.test(t);
}

function inferDistanceUnitFromText(text: string): 'MILES' | 'KM' | 'M' | null {
  const t = normalizePlanText(text).toLowerCase();
  if (/\d+(?:\.\d+)?\s*(?:miles?|mile|mi)\b/.test(t)) return 'MILES';
  if (/\d+(?:\.\d+)?\s*(?:km|kms|kilometers?|kilometres?)\b/.test(t)) return 'KM';
  if (hasMetersNotation(t)) return 'M';
  return null;
}

function normalizeDistanceValue(distance: number | null, unit: 'MILES' | 'KM' | 'M' | null): DistanceParseResult {
  if (distance === null || !Number.isFinite(distance) || distance <= 0 || !unit) {
    return { distance: null, distanceUnit: null };
  }
  if (unit === 'M') {
    return { distance: distance / 1000, distanceUnit: 'KM' };
  }
  return { distance, distanceUnit: unit };
}

function convertDistanceValue(value: number, from: UnitPreference, to: UnitPreference) {
  if (from === to) return value;
  if (from === 'MILES' && to === 'KM') return value * 1.609344;
  return value / 1.609344;
}

function convertDistanceToStorageUnit(distance: DistanceParseResult, storageUnit: UnitPreference): DistanceParseResult {
  if (distance.distance === null || distance.distanceUnit === null) {
    return { distance: null, distanceUnit: null };
  }
  if (distance.distanceUnit === storageUnit) return distance;
  const converted = convertDistanceValue(distance.distance, distance.distanceUnit, storageUnit);
  return {
    distance: Number(converted.toFixed(2)),
    distanceUnit: storageUnit
  };
}

function resolveDistanceFromValueUnit(
  distanceCandidate: unknown,
  unitCandidate: unknown,
  rawText: string
): DistanceParseResult {
  const numeric = parseNumber(distanceCandidate);
  let unit = asUpperDistanceUnit(unitCandidate);
  if (!unit) unit = inferDistanceUnitFromText(rawText);
  return normalizeDistanceValue(numeric, unit);
}

function resolveDistanceFromSegmentMetrics(metrics: Record<string, unknown>, rawText: string): DistanceParseResult {
  const direct = resolveDistanceFromValueUnit(metrics?.distance_value, metrics?.distance_unit, rawText);
  if (direct.distance !== null) return direct;

  const fromMiles = resolveDistanceFromValueUnit(
    metrics?.distance_miles ?? (metrics?.distance_miles_range as number[] | undefined)?.[1] ?? null,
    'miles',
    rawText
  );
  if (fromMiles.distance !== null) return fromMiles;

  const fromKm = resolveDistanceFromValueUnit(
    metrics?.distance_km ?? (metrics?.distance_km_range as number[] | undefined)?.[1] ?? null,
    'km',
    rawText
  );
  if (fromKm.distance !== null) return fromKm;

  const fromMeters = resolveDistanceFromValueUnit(
    metrics?.distance_meters ?? (metrics?.distance_meters_range as number[] | undefined)?.[1] ?? null,
    'm',
    rawText
  );
  if (fromMeters.distance !== null) return fromMeters;

  return { distance: null, distanceUnit: null };
}

function inferDominantDistanceUnit(texts: string[], fallback: UnitPreference): UnitPreference {
  let milesHits = 0;
  let kmHits = 0;

  for (const text of texts) {
    const t = normalizePlanText(text || '').toLowerCase();
    if (!t) continue;

    const mileMatchCount = (t.match(/\b\d+(?:\.\d+)?\s*(?:miles?|mile|mi)\b/g) || []).length;
    const kmMatchCount = (t.match(/\b\d+(?:\.\d+)?\s*(?:km|kms|kilometers?|kilometres?)\b/g) || []).length;
    const compactKCount = (t.match(/\b\d+(?:\.\d+)?k\b/g) || []).length;
    const meterCount = hasMetersNotation(t) ? 1 : 0;

    milesHits += mileMatchCount;
    kmHits += kmMatchCount + compactKCount + meterCount;
  }

  if (milesHits === 0 && kmHits === 0) return fallback;
  if (kmHits > milesHits) return 'KM';
  if (milesHits > kmHits) return 'MILES';
  return fallback;
}

function resolveImpliedRunDistanceFromText(rawText: string, defaultUnit: UnitPreference | null): DistanceParseResult {
  if (!defaultUnit) return { distance: null, distanceUnit: null };

  const text = normalizePlanText(rawText).toLowerCase();
  const runContext = /\b(run|tempo|easy|recovery|trail|long run|training race|race|progression|fast finish|threshold|t[\s-]?pace|lr)\b/.test(text)
    || /\b(course|lauf|laufen)\b/.test(text)
    || /\b(?:e|t|lr)\s*\d+(?:\.\d+)?\b/.test(text);
  const nonRunContext = /\b(strength|rest|yoga|hike|cross|xt|bike|swim)\b/.test(text);
  if (!runContext || nonRunContext) return { distance: null, distanceUnit: null };

  const patterns = [
    /\b(?:e|t|lr|run|tempo|easy|recovery|trail|progression|long run)\s*[:\-]?\s*(\d+(?:\.\d+)?)\b(?!\s*(?:min|mins|minutes|hr|hrs|hour|hours|sec|secs|seconds)\b)/i,
    /\b(\d+(?:\.\d+)?)\s*(?:easy|tempo|steady|threshold|progression|run)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 80) continue;
    return normalizeDistanceValue(value, defaultUnit);
  }

  return { distance: null, distanceUnit: null };
}

function resolveDistanceFromText(rawText: string, defaultUnit: UnitPreference | null = null): DistanceParseResult {
  const text = normalizePlanText(rawText).toLowerCase();

  const repeated = text.match(
    /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(mile|miles|mi|km|kms|kilometer|kilometre|kilometers|kilometres|k|m|meter|meters|metre|metres)\b/
  );
  if (repeated) {
    const reps = Number(repeated[1]);
    const each = Number(repeated[2]);
    const unitToken = repeated[3] === 'k' ? 'km' : repeated[3];
    if (Number.isFinite(reps) && reps > 0 && Number.isFinite(each) && each > 0) {
      return normalizeDistanceValue(reps * each, asUpperDistanceUnit(unitToken));
    }
  }

  const withUnit = text.match(
    /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(miles?|mile|mi|km|kms|kilometers?|kilometres?|k|meters?|metres?|m)\b/
  );
  if (withUnit) {
    const range = parseRange(withUnit[1].replace(/\s/g, ''));
    const unitToken = withUnit[2] === 'k' ? 'km' : withUnit[2];
    if (range) {
      return normalizeDistanceValue(range.max, asUpperDistanceUnit(unitToken));
    }
  }

  const compactK = text.match(/\b(\d+(?:\.\d+)?)k\b/);
  if (compactK) {
    return normalizeDistanceValue(Number(compactK[1]), 'KM');
  }

  const implied = resolveImpliedRunDistanceFromText(rawText, defaultUnit);
  if (implied.distance !== null) return implied;

  return { distance: null, distanceUnit: null };
}

function resolveDurationFromText(rawText: string): number | null {
  const text = normalizePlanText(rawText).toLowerCase();

  const repeated = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|seconds?|secs?|sec)\b/);
  if (repeated) {
    const reps = Number(repeated[1]);
    const each = Number(repeated[2]);
    const unit = repeated[3];
    if (Number.isFinite(reps) && reps > 0 && Number.isFinite(each) && each > 0) {
      if (unit.startsWith('h')) return Math.round(reps * each * 60);
      if (unit.startsWith('s')) return Math.round((reps * each) / 60);
      return Math.round(reps * each);
    }
  }

  const hourMinute = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\s*(\d{1,2})?\s*(?:minutes?|mins?|min)?\b/);
  if (hourMinute) {
    const hours = Number(hourMinute[1]);
    const mins = hourMinute[2] ? Number(hourMinute[2]) : 0;
    if (Number.isFinite(hours) && Number.isFinite(mins)) {
      return Math.round(hours * 60 + mins);
    }
  }

  const minutes = text.match(/\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min)\b/);
  if (minutes) {
    const mins = Number(minutes[1]);
    if (Number.isFinite(mins) && mins > 0) return Math.round(mins);
  }

  const apostropheMinutes = text.match(/\b(\d+(?:\.\d+)?)\s*[’']/);
  if (apostropheMinutes) {
    const mins = Number(apostropheMinutes[1]);
    if (Number.isFinite(mins) && mins > 0 && mins <= 300) return Math.round(mins);
  }

  return null;
}

const ACTIVITY_ABBREVIATION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bwu\b/gi, 'warm up'],
  [/\bcd\b/gi, 'cool down'],
  [/\blrl\b/gi, 'long run'],
  [/\blr\b/gi, 'long run'],
  [/\bstr\b/gi, 'strength'],
  [/\bstre\b/gi, 'strength'],
  [/\brst\b/gi, 'rest'],
  [/\bxt\b/gi, 'cross training'],
  [/\bx[-\s]?train(?:ing)?\b/gi, 'cross training'],
  [/\bcross[-\s]?train\b/gi, 'cross training'],
  [/\bmob\b/gi, 'mobility'],
  [/\byog\b/gi, 'yoga'],
  [/\bhik\b/gi, 'hike'],
  [/\brec\b/gi, 'recovery'],
  [/\bff\b/gi, 'fast finish'],
  [/\bmp\b/gi, 'marathon pace'],
  [/\brp\b/gi, 'race pace'],
  [/\be(?=\s*\d)/gi, 'easy run'],
  [/\bt(?=\s*\d)/gi, 'tempo'],
  [/\bi(?=\s*\d)/gi, 'interval']
];

function decodeActivityText(rawText: string) {
  let decoded = normalizePlanText(rawText);
  for (const [pattern, replacement] of ACTIVITY_ABBREVIATION_REPLACEMENTS) {
    decoded = decoded.replace(pattern, replacement);
  }
  return normalizeWhitespace(decoded);
}

function normalizeSubtypeToken(value: string | null | undefined) {
  if (!value) return null;
  const token = normalizePlanText(value)
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z-]/g, '')
    .trim();

  if (!token) return null;
  if (token === 'run') return 'run';
  if (token === 'strength' || token === 'str' || token === 'stre') return 'strength';
  if (token === 'cross-training' || token === 'cross-train' || token === 'xtraining' || token === 'xt' || token === 'cross') return 'cross-training';
  if (token === 'rest' || token === 'rest-day' || token === 'rst') return 'rest';
  if (token === 'hike' || token === 'hik') return 'hike';
  if (token === 'yoga' || token === 'yog') return 'yoga';
  if (token === 'mobility' || token === 'mob') return 'mobility';
  if (token === 'tempo' || token === 'threshold' || token === 't') return 'tempo';
  if (token === 'progression') return 'progression';
  if (token === 'recovery' || token === 'recovery-run' || token === 'rec') return 'recovery';
  if (token === 'trail' || token === 'trail-run') return 'trail-run';
  if (token === 'fast-finish' || token === 'ff') return 'fast-finish';
  if (token === 'long-run' || token === 'longrun' || token === 'lr' || token === 'lrl') return 'lrl';
  if (token === 'interval' || token === 'intervals') return 'interval';
  if (token === 'time-trial' || token === 'timetrial') return 'time-trial';
  if (token === 'hills' || token === 'hill') return 'hills';
  if (token === 'hill-pyramid') return 'hill-pyramid';
  if (token === 'incline-treadmill') return 'incline-treadmill';
  if (token === 'training-race') return 'training-race';
  if (token === 'race') return 'race';
  return token;
}

function inferSubtype(text: string) {
  const t = normalizePlanText(text).toLowerCase();
  if (t.includes('strength') || /\b(?:str|stre)\b/.test(t) || /\bst\s*\d/i.test(t)) return 'strength';
  if (/\b(?:rest|rst)\s*(day)?\b/.test(t)) return 'rest';
  if (t.includes('cross') || /\b(?:xt|xtrain)\b/.test(t)) return 'cross-training';
  if (t.includes('training race')) return 'training-race';
  if (/\brace\b/.test(t)) return 'race';
  if (t.includes('incline treadmill')) return 'incline-treadmill';
  if (t.includes('hill pyramid')) return 'hill-pyramid';
  if (/\bhills?\b/.test(t)) return 'hills';
  if (/\btempo\b/.test(t) || /\bt(?=\s*\d)/i.test(text)) return 'tempo';
  if (t.includes('progress')) return 'progression';
  if (t.includes('recovery') || /\brec\b/.test(t)) return 'recovery';
  if (/\btrail\b/.test(t)) return 'trail-run';
  if (t.includes('fast finish') || /\bff\b/.test(t)) return 'fast-finish';
  if (/\blrl\b/.test(t) || /\blong run\b/.test(t) || /\blr\b/.test(t)) return 'lrl';
  if (/\bhike\b/.test(t)) return 'hike';
  if (/\byoga\b/.test(t)) return 'yoga';
  if (/\bmobility\b/.test(t) || /\bmob\b/.test(t)) return 'mobility';
  if (/\beasy\b/.test(t) || /\be\s+\d/.test(t)) return 'easy-run';
  // If text contains distance info, likely a run
  if (/\d+(?:\.\d+)?\s*(?:miles?|mi|km|meters?|metres?)\b/.test(t) || /\d{3,4}\s*m\b/.test(t)) {
    return 'easy-run';
  }
  return 'unknown';
}

function mapActivityType(subtype: string) {
  if (subtype === 'run') return 'RUN';
  if (subtype === 'strength') return 'STRENGTH';
  if (subtype === 'cross-training') return 'CROSS_TRAIN';
  if (subtype === 'rest') return 'REST';
  if (subtype === 'hike') return 'HIKE';
  if (subtype === 'yoga') return 'YOGA';
  if (subtype === 'mobility') return 'MOBILITY';
  if (RUN_SUBTYPES.has(subtype)) return 'RUN';
  return 'OTHER';
}

function mapAiTypeToActivityType(type: string | null | undefined) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'run') return 'RUN';
  if (normalized === 'strength') return 'STRENGTH';
  if (normalized === 'cross_train') return 'CROSS_TRAIN';
  if (normalized === 'rest') return 'REST';
  if (normalized === 'hike') return 'HIKE';
  if (normalized === 'yoga') return 'YOGA';
  if (normalized === 'mobility') return 'MOBILITY';
  return 'OTHER';
}

function mapAiSessionTypeToSubtype(sessionType: string | null | undefined) {
  const token = String(sessionType || '').trim().toLowerCase();
  if (!token) return null;
  if (token === 'easy') return 'easy-run';
  if (token === 'long_run') return 'lrl';
  if (token === 'interval') return 'interval';
  if (token === 'tempo') return 'tempo';
  if (token === 'hill') return 'hills';
  if (token === 'recovery') return 'recovery';
  if (token === 'rest') return 'rest';
  if (token === 'cross_train') return 'cross-training';
  if (token === 'strength') return 'strength';
  if (token === 'race') return 'race';
  if (token === 'time_trial') return 'time-trial';
  return null;
}

function mapAiPrimarySportToType(primarySport: string | null | undefined) {
  const normalized = String(primarySport || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'run') return 'RUN';
  if (normalized === 'strength') return 'STRENGTH';
  if (normalized === 'mobility') return 'MOBILITY';
  if (normalized === 'bike' || normalized === 'swim') return 'CROSS_TRAIN';
  return null;
}

function parseRange(value: string) {
  const parts = value.split('-').map((v) => Number(v.trim()));
  if (parts.length === 2 && parts.every((v) => !Number.isNaN(v))) {
    return { min: parts[0], max: parts[1] };
  }
  const single = Number(value);
  if (!Number.isNaN(single)) return { min: single, max: single };
  return null;
}

function extractDistanceRange(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const range = parseRange(match[1].replace(/\s/g, ''));
    if (!range) continue;

    const matchUnit = inferDistanceUnitFromText(match[0]) || 'MILES';
    return {
      distance: range,
      unit: matchUnit === 'M' ? 'm' : matchUnit.toLowerCase()
    };
  }

  return null;
}

function parseStructure(text: string) {
  const normalizedText = normalizePlanText(text);
  const structure: any = {};
  const warmup = extractDistanceRange(normalizedText, [
    /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|mi|km|kilometer|kilometre|meter|meters|metre|metres|m)\s*(?:WU|warm[\s-]?up)\b/i,
    /(?:WU|warm[\s-]?up)\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|mi|km|kilometer|kilometre|meter|meters|metre|metres|m)\b/i
  ]);
  if (warmup) {
    structure.warmup = warmup;
  }

  const cooldown = extractDistanceRange(normalizedText, [
    /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|mi|km|kilometer|kilometre|meter|meters|metre|metres|m)\s*(?:CD|cool[\s-]?down)\b/i,
    /(?:CD|cool[\s-]?down)\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|mi|km|kilometer|kilometre|meter|meters|metre|metres|m)\b/i
  ]);
  if (cooldown) {
    structure.cooldown = cooldown;
  }

  const tempo = extractDistanceRange(normalizedText, [
    /T[:\s]\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|mi|km|kilometer|kilometre|meter|meters|metre|metres|m)\b/i,
    /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(?:mile|miles|mi|km|kilometer|kilometre|meter|meters|metre|metres|m)\s*(?:tempo|threshold|t[\s-]?pace)\b/i
  ]);
  if (tempo) {
    structure.tempo = tempo;
  }

  const intervalMatch = normalizedText.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(second|seconds|sec|minute|minutes|min)/i);
  if (intervalMatch) {
    const reps = Number(intervalMatch[1]);
    const duration = Number(intervalMatch[2]);
    const unit = intervalMatch[3].startsWith('s') ? 'sec' : 'min';
    structure.intervals = [
      {
        reps,
        work: { duration: unit === 'sec' ? duration : duration * 60, unit: 'sec' }
      }
    ];
  }
  return Object.keys(structure).length ? structure : null;
}

function resolveDistanceFromStructure(structure: any): DistanceParseResult {
  if (!structure || typeof structure !== 'object') {
    return { distance: null, distanceUnit: null };
  }

  const parts = ['warmup', 'tempo', 'cooldown']
    .map((key) => structure[key])
    .filter(Boolean) as Array<{ distance?: { max?: number }, unit?: string }>;

  if (!parts.length) {
    return { distance: null, distanceUnit: null };
  }

  const sharedUnit = parts[0]?.unit;
  if (!sharedUnit || parts.some((part) => part.unit !== sharedUnit || typeof part.distance?.max !== 'number')) {
    return { distance: null, distanceUnit: null };
  }

  const total = parts.reduce((sum, part) => sum + Number(part.distance?.max || 0), 0);
  if (sharedUnit === 'm') return normalizeDistanceValue(total, 'M');
  if (sharedUnit === 'km') return normalizeDistanceValue(total, 'KM');
  if (sharedUnit === 'mile' || sharedUnit === 'miles') return normalizeDistanceValue(total, 'MILES');
  return { distance: null, distanceUnit: null };
}

function expandAlternatives(text: string) {
  const normalized = normalizePlanText(text);
  const restOr = normalized.match(/rest day or (.+)/i) || normalized.match(/rest or (.+)/i);
  if (restOr) {
    return ['Rest day', restOr[1]];
  }
  return [text];
}

function splitCombinedActivities(text: string) {
  const source = normalizeWhitespace(text);
  if (!source) return [];
  const normalized = normalizePlanText(source).toLowerCase();
  const hasWu = /\b(?:wu|warm[\s-]?up)\b/.test(normalized);
  const hasTempo = /\btempo\b/.test(normalized) || /\bt(?=[:\s]*\d)/i.test(source);
  const hasCd = /\b(?:cd|cool[\s-]?down)\b/.test(normalized);
  const hasNonRunMarker = /\b(?:strength|rest|cross|xt|mobility|yoga|hike)\b/.test(normalized);

  // Structured run phases (WU/T/CD) belong to one run activity, not separate activities.
  if (!hasNonRunMarker && ((hasWu && hasTempo) || (hasTempo && hasCd) || (hasWu && hasCd))) {
    return [source];
  }

  const parts: string[] = [];
  let depth = 0;
  let current = '';

  const flush = () => {
    const trimmed = normalizeWhitespace(current);
    if (trimmed) parts.push(trimmed);
    current = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (depth === 0) {
      if (char === '+' && source[i - 1] !== '+' && source[i + 1] !== '+') {
        flush();
        continue;
      }
      if (char === ';' || char === '|') {
        flush();
        continue;
      }
      if (char === '/' && /\s/.test(source[i - 1] || '') && /\s/.test(source[i + 1] || '')) {
        flush();
        continue;
      }
    }

    current += char;
  }

  flush();
  return parts.length ? parts : [source];
}

type ActivityDraft = {
  planId: string;
  dayId: string;
  type: string;
  subtype: string | null;
  title: string;
  rawText: string | null;
  sessionInstructions?: string | null;
  distance: number | null;
  distanceUnit: 'MILES' | 'KM' | null;
  duration: number | null;
  paceTarget?: string | null;
  effortTarget?: string | null;
  paceTargetMode?: 'SYMBOLIC' | 'NUMERIC' | 'RANGE' | 'HYBRID' | 'UNKNOWN' | null;
  paceTargetBucket?: PaceBucket | null;
  paceTargetMinSec?: number | null;
  paceTargetMaxSec?: number | null;
  paceTargetUnit?: 'MILES' | 'KM' | null;
  effortTargetType?: 'RPE' | 'HR_ZONE' | 'HR_BPM' | 'TEXT' | null;
  effortTargetMin?: number | null;
  effortTargetMax?: number | null;
  effortTargetZone?: number | null;
  effortTargetBpmMin?: number | null;
  effortTargetBpmMax?: number | null;
  structure?: any;
  tags?: any;
  priority: string | null;
  bailAllowed: boolean;
  mustDo: boolean;
};

function ensureDistanceConsistency(activity: ActivityDraft): ActivityDraft {
  if (activity.distance === null || activity.distanceUnit === null) {
    return { ...activity, distance: null, distanceUnit: null, paceTargetUnit: null };
  }
  return activity;
}

function withStructuredIntensityTargets(activity: ActivityDraft): ActivityDraft {
  const structured = deriveStructuredIntensityTargets({
    paceTarget: activity.paceTarget ?? null,
    effortTarget: activity.effortTarget ?? null,
    fallbackUnit: activity.distanceUnit
  });
  return {
    ...activity,
    ...structured
  };
}

function normalizeMatchText(text: string | null | undefined) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countAbbreviationTokens(text: string) {
  return (text.match(/\b(?:wu|cd|lr|lrl|xt|str|rst|mob|yog|hik|rp|mp|ns|ff|rec)\b/gi) || []).length;
}

function chooseActivityRawText(baseRaw: string | null | undefined, aiRaw: string | null | undefined) {
  const base = normalizeWhitespace(String(baseRaw || ''));
  const ai = normalizeWhitespace(String(aiRaw || ''));

  if (!ai) return base || null;
  if (!base) return ai;

  const baseAbbrCount = countAbbreviationTokens(base);
  const aiAbbrCount = countAbbreviationTokens(ai);

  if (aiAbbrCount < baseAbbrCount) return ai;
  if (ai.length >= base.length + 6) return ai;
  return base;
}

function normalizeTargetText(value: unknown) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function paceBucketFromSubtype(subtype: string | null | undefined): PaceBucket | null {
  if (!subtype) return null;
  if (subtype === 'recovery') return 'RECOVERY';
  if (subtype === 'easy-run') return 'EASY';
  if (subtype === 'lrl') return 'LONG';
  if (subtype === 'race' || subtype === 'training-race' || subtype === 'time-trial') return 'RACE';
  if (subtype === 'tempo' || subtype === 'progression' || subtype === 'fast-finish') return 'TEMPO';
  if (subtype === 'interval' || subtype === 'hills' || subtype === 'hill-pyramid' || subtype === 'incline-treadmill') return 'INTERVAL';
  return null;
}

function deriveDeterministicIntensityTargets(args: {
  rawText: string;
  metrics: Record<string, unknown>;
  activityType: string;
  subtype: string | null;
}) {
  const { rawText, metrics, activityType, subtype } = args;
  const metricPaceTarget = normalizeTargetText(metrics?.pace_target);
  const metricEffortTarget = normalizeTargetText(metrics?.effort_target);
  const textPaceTarget = extractPaceTargetFromText(rawText);
  const textEffortTarget = extractEffortTargetFromText(rawText);
  const subtypeBucket = paceBucketFromSubtype(subtype);
  const subtypePaceTarget = activityType === 'RUN' && subtypeBucket
    ? paceBucketLabel(subtypeBucket)
    : null;

  return {
    paceTarget: metricPaceTarget ?? textPaceTarget ?? subtypePaceTarget ?? null,
    effortTarget: metricEffortTarget ?? textEffortTarget ?? null
  };
}

function choosePaceTarget(baseTarget: string | null | undefined, aiTarget: string | null | undefined) {
  const base = normalizeTargetText(baseTarget);
  const ai = normalizeTargetText(aiTarget);
  if (!base) return ai;
  if (!ai) return base;

  const baseConcrete = hasConcretePaceValue(base);
  const aiConcrete = hasConcretePaceValue(ai);
  if (baseConcrete !== aiConcrete) return aiConcrete ? ai : base;

  const baseSymbolic = inferSymbolicPaceBucketFromText(base) !== null;
  const aiSymbolic = inferSymbolicPaceBucketFromText(ai) !== null;
  if (baseSymbolic !== aiSymbolic) return aiSymbolic ? ai : base;

  if (ai.length >= base.length + 6) return ai;
  return base;
}

function chooseEffortTarget(baseTarget: string | null | undefined, aiTarget: string | null | undefined) {
  const base = normalizeTargetText(baseTarget);
  const ai = normalizeTargetText(aiTarget);
  if (!base) return ai;
  if (!ai) return base;
  if (ai.length >= base.length + 6) return ai;
  return base;
}

function scoreDayForAiPass(rawText: string) {
  const text = normalizeWhitespace(rawText || '');
  if (!text) return 0;

  const normalized = normalizePlanText(text).toLowerCase();
  let score = 0;

  if (/[★♥]/.test(text)) score += 2;
  if (/[;|]/.test(text)) score += 2;
  if (/\b(?:wu|cd|xt|str|rst|mob|yog|hik|rp|mp|ns|ff)\b/i.test(normalized)) score += 3;
  if (/\b(?:lr|lrl)\b/i.test(normalized)) score += 2;
  if (/\b(?:e|t|i)\s*:/i.test(normalized)) score += 2;
  if (/\b\d+\s*x\s*\d+(?:\.\d+)?\b/i.test(normalized)) score += 2;
  if (/\([^)]*\d[^)]*\)/.test(text)) score += 1;
  if (text.length > 44) score += 1;
  if ((text.match(/\d+(?:\.\d+)?\s*(?:miles?|mi|km|meters?|metres?|m)\b/gi) || []).length > 1) score += 1;

  return score;
}

function selectAiTargetDayKeys(rawDays: Record<string, string>, maxDays: number) {
  return DAY_KEYS
    .map((dayKey) => {
      const rawText = rawDays[dayKey] || '';
      return { dayKey, score: scoreDayForAiPass(rawText) };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxDays))
    .map((candidate) => candidate.dayKey);
}

function scoreActivityMatch(base: ActivityDraft, ai: ActivityDraft) {
  let score = 0;

  if (base.type === ai.type) score += 4;
  if (base.subtype && ai.subtype && base.subtype === ai.subtype) score += 4;

  const baseRaw = normalizeMatchText(base.rawText);
  const aiRaw = normalizeMatchText(ai.rawText);
  if (baseRaw && aiRaw) {
    if (baseRaw === aiRaw) score += 8;
    else if (baseRaw.includes(aiRaw) || aiRaw.includes(baseRaw)) score += 5;
  }

  const baseTitle = normalizeMatchText(base.title);
  const aiTitle = normalizeMatchText(ai.title);
  if (baseTitle && aiTitle) {
    if (baseTitle === aiTitle) score += 3;
    else if (baseTitle.includes(aiTitle) || aiTitle.includes(baseTitle)) score += 2;
  }

  if (base.distance !== null && ai.distance !== null && base.distanceUnit && ai.distanceUnit && base.distanceUnit === ai.distanceUnit) {
    const delta = Math.abs(base.distance - ai.distance);
    if (delta < 0.2) score += 2;
    else if (delta < 0.5) score += 1;
  }

  return score;
}

function mergeActivityDraft(base: ActivityDraft, ai: ActivityDraft): ActivityDraft {
  const preferBaseSubtype = Boolean(base.subtype && base.subtype !== 'unknown');
  const baseIsGenericTitle = base.title === 'Workout';
  const baseIsOtherType = base.type === 'OTHER';

  return ensureDistanceConsistency({
    ...base,
    type: baseIsOtherType ? (ai.type || base.type) : base.type,
    subtype: preferBaseSubtype ? base.subtype : (ai.subtype ?? base.subtype),
    title: baseIsGenericTitle && ai.title ? ai.title : base.title,
    rawText: chooseActivityRawText(base.rawText, ai.rawText),
    distance: base.distance ?? ai.distance,
    distanceUnit: base.distanceUnit ?? ai.distanceUnit,
    duration: base.duration ?? ai.duration,
    paceTarget: choosePaceTarget(base.paceTarget, ai.paceTarget),
    effortTarget: chooseEffortTarget(base.effortTarget, ai.effortTarget),
    structure: base.structure || ai.structure || null,
    tags: base.tags || ai.tags || null,
    priority: base.priority ?? ai.priority ?? null,
    bailAllowed: base.bailAllowed || ai.bailAllowed,
    mustDo: base.mustDo || ai.mustDo
  });
}

function mergeDayActivitiesWithAI(baseActivities: ActivityDraft[], aiActivities: ActivityDraft[]) {
  if (!aiActivities.length) return baseActivities;
  if (!baseActivities.length) return aiActivities;

  const usedAi = new Set<number>();
  const merged: ActivityDraft[] = [];

  for (const base of baseActivities) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < aiActivities.length; i += 1) {
      if (usedAi.has(i)) continue;
      const score = scoreActivityMatch(base, aiActivities[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= 4) {
      usedAi.add(bestIdx);
      merged.push(mergeActivityDraft(base, aiActivities[bestIdx]));
    } else {
      merged.push(base);
    }
  }

  for (let i = 0; i < aiActivities.length; i += 1) {
    if (!usedAi.has(i)) merged.push(aiActivities[i]);
  }

  return merged;
}

function buildDeterministicActivities(args: {
  planId: string;
  dayId: string;
  entry: any;
  inferredDistanceUnit: UnitPreference;
  storageDistanceUnit: UnitPreference;
}) {
  const { planId, dayId, entry, inferredDistanceUnit, storageDistanceUnit } = args;
  const drafts: ActivityDraft[] = [];

  const segments = entry?.segments_parsed?.length
    ? entry.segments_parsed
    : [
      {
        text: entry?.raw || '',
        type: entry?.type_guess || 'unknown',
        metrics: entry?.metrics || {}
      }
    ];

  for (const seg of segments) {
    const splitSegments = splitCombinedActivities(seg.text || '');
    const variants = splitSegments.flatMap((segmentText) => expandAlternatives(segmentText));
    for (const variantText of variants) {
      const originalText = variantText.trim();
      if (!originalText) continue;

      const cleanText = originalText.replace(/[★♥]/g, '').trim();
      const decodedText = decodeActivityText(cleanText || originalText);
      const inferred = inferSubtype(decodedText || originalText);
      const normalizedSegSubtype = normalizeSubtypeToken(seg.type || null);
      const subtype = inferred !== 'unknown' ? inferred : (normalizedSegSubtype || 'unknown');
      const activityType = mapActivityType(subtype);
      const mustDo = originalText.includes('★');
      const bailAllowed = originalText.includes('♥');

      const metrics = seg.metrics || {};
      const parsedDistance = resolveDistanceFromSegmentMetrics(metrics, decodedText || originalText);
      const duration =
        metrics?.duration_minutes ??
        metrics?.duration_minutes_range?.[1] ??
        resolveDurationFromText(decodedText || originalText) ??
        null;

      const structure = parseStructure(decodedText || originalText);
      const structuredDistance = parsedDistance.distance === null
        ? resolveDistanceFromStructure(structure)
        : parsedDistance;
      const textDistance = structuredDistance.distance === null
        ? resolveDistanceFromText(decodedText || originalText, inferredDistanceUnit)
        : structuredDistance;
      const storageDistance = convertDistanceToStorageUnit(textDistance, storageDistanceUnit);
      const title =
        activityType === 'REST'
          ? 'Rest Day'
          : SUBTYPE_TITLES[subtype] || titleCase(subtype === 'unknown' ? 'Workout' : subtype);
      const intensityTargets = deriveDeterministicIntensityTargets({
        rawText: decodedText || originalText,
        metrics,
        activityType,
        subtype
      });

      drafts.push(ensureDistanceConsistency({
        planId,
        dayId,
        type: activityType,
        subtype,
        title,
        rawText: decodedText || cleanText || originalText,
        distance: storageDistance.distance,
        distanceUnit: storageDistance.distanceUnit,
        duration,
        paceTarget: normalizePaceForStorage(
          intensityTargets.paceTarget,
          storageDistance.distanceUnit ?? storageDistanceUnit
        ),
        effortTarget: intensityTargets.effortTarget,
        structure: structure || null,
        priority: mustDo ? 'KEY' : bailAllowed ? 'OPTIONAL' : null,
        mustDo,
        bailAllowed
      }));
    }
  }

  return drafts;
}

function buildAiActivities(args: {
  planId: string;
  dayId: string;
  dayRawText: string;
  aiActivities: any[];
  inferredDistanceUnit: UnitPreference;
  storageDistanceUnit: UnitPreference;
}) {
  const { planId, dayId, dayRawText, aiActivities, inferredDistanceUnit, storageDistanceUnit } = args;
  const drafts: ActivityDraft[] = [];

  for (const a of aiActivities) {
    const sourceRawText = normalizeWhitespace(String(a.raw_text || dayRawText || ''));
    const decodedRawText = decodeActivityText(sourceRawText);
    const instructionText = normalizeWhitespace(String(a.instruction_text || ''));
    const sessionInstructions = instructionText || null;
    const displayRawText = decodedRawText || null;
    const normalizedSubtype = normalizeSubtypeToken(a.subtype || null);
    const sessionSubtype = mapAiSessionTypeToSubtype(a.session_type || null);
    const inferredSubtype = inferSubtype(displayRawText || String(a.title || ''));
    const effectiveSubtype =
      normalizedSubtype && normalizedSubtype !== 'unknown'
        ? normalizedSubtype
        : sessionSubtype
          ? sessionSubtype
        : inferredSubtype !== 'unknown'
          ? inferredSubtype
          : null;
    const aiType = mapAiTypeToActivityType(a.type || null);
    const primarySportType = mapAiPrimarySportToType(a.primary_sport || null);
    const effectiveType = aiType === 'OTHER' && primarySportType ? primarySportType : aiType;
    const aiDistance = resolveDistanceFromValueUnit(
      a.metrics?.distance?.value ?? null,
      a.metrics?.distance?.unit ?? null,
      decodedRawText || dayRawText || ''
    );
    const fallbackTextDistance = aiDistance.distance === null
      ? resolveDistanceFromText(decodedRawText || dayRawText || '', inferredDistanceUnit)
      : aiDistance;
    const storageDistance = convertDistanceToStorageUnit(fallbackTextDistance, storageDistanceUnit);
    const aiDuration = a.metrics?.duration_min ?? resolveDurationFromText(decodedRawText || dayRawText || '') ?? null;
    const normalizedTitle = normalizeWhitespace(String(a.title || ''));
    const intensityType = String(a.target_intensity?.type || '').trim().toLowerCase();
    const intensityValue = normalizeWhitespace(String(a.target_intensity?.value || ''));
    const paceFromTarget = intensityType === 'pace' ? intensityValue : null;
    const effortFromTarget = intensityType && intensityType !== 'pace'
      ? `${intensityType.toUpperCase()}: ${intensityValue}`.trim()
      : null;
    const inferredPriority = a.is_key_session === true
      ? 'KEY'
      : a.priority
        ? String(a.priority).toUpperCase()
        : null;
    const warmupCooldownTag = a.warmup_cooldown_included === true ? ['warmup_cooldown_included'] : [];
    const existingTags = Array.isArray(a.tags) ? a.tags : [];
    const fallbackTitle = effectiveSubtype
      ? SUBTYPE_TITLES[effectiveSubtype] || titleCase(effectiveSubtype)
      : 'Workout';
    const textPaceTarget = extractPaceTargetFromText(displayRawText || decodedRawText || dayRawText || '');
    const textEffortTarget = extractEffortTargetFromText(displayRawText || decodedRawText || dayRawText || '');
    drafts.push(ensureDistanceConsistency({
      planId,
      dayId,
      type: effectiveType,
      subtype: effectiveSubtype,
      title: normalizedTitle || fallbackTitle,
      rawText: displayRawText,
      sessionInstructions,
      distance: storageDistance.distance,
      distanceUnit: storageDistance.distanceUnit,
      duration: aiDuration,
      paceTarget: normalizePaceForStorage(
        choosePaceTarget(a.metrics?.pace_target ?? paceFromTarget, textPaceTarget),
        storageDistance.distanceUnit ?? storageDistanceUnit
      ),
      effortTarget: chooseEffortTarget(a.metrics?.effort_target ?? effortFromTarget, textEffortTarget),
      structure: a.structure || null,
      tags: [...existingTags, ...warmupCooldownTag],
      priority: inferredPriority,
      bailAllowed: Boolean(a.constraints?.bail_allowed),
      mustDo: Boolean(a.constraints?.must_do)
    }));
  }

  return drafts;
}

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
};

type RowCluster = {
  y: number;
  items: PdfTextItem[];
};

type TableHeader = {
  y: number;
  columns: number[];
  twmColumn: number | null;
};

type WeekDayBuckets = Record<string, string[]>;

type DayTextSegment = {
  dayKey: string;
  content: string;
};

type TextFallbackDiagnostics = {
  pagesScanned: number;
  rowClusters: number;
  weekMarkersFound: number;
  dayMarkersFound: number;
  linesAssigned: number;
  continuationLines: number;
  linesDroppedNoWeek: number;
  linesDroppedNoDay: number;
};

type PendingImplicitLine = {
  dayKey: string;
  content: string;
  continuation: boolean;
};

function stripSuperscriptFootnotes(text: string) {
  return text
    // Superscript/subscript unicode blocks commonly used for footnote markers in PDFs.
    .replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]/g, '')
    // Common standalone footnote symbols.
    .replace(/[†‡§¶‖※]/g, ' ')
    // Keep symbol markers (key/optional), but drop attached index digits like ★4, ♥8.
    .replace(/([★♥])\d{1,2}\b/g, '$1')
    // Drop attached footnote indices like RP9, CD5, finish11, NS10.
    .replace(/\b([A-Za-z]{2,})(\d{1,2})(?=[:;,.!?)]|\s|$)/g, '$1')
    // Bracketed/parenthesized footnote ids, e.g. [1], (2), (iv).
    .replace(/\s*(?:\[\s*(?:\d{1,3}|[ivx]{1,6})\s*\]|\(\s*(?:\d{1,3}|[ivx]{1,6})\s*\))(?=\s|$)/gi, ' ')
    // Stray reference arrows used in some exports.
    .replace(/\s*[>›](?=\s|$)/g, ' ');
}

function normalizeWhitespace(text: string) {
  return stripSuperscriptFootnotes(text)
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+\+\s+/g, ' + ')
    .trim();
}

function clusterRows(items: PdfTextItem[], tolerance = 2): RowCluster[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const clusters: RowCluster[] = [];

  for (const item of sorted) {
    const cluster = clusters.find((c) => Math.abs(c.y - item.y) <= tolerance);
    if (!cluster) {
      clusters.push({ y: item.y, items: [item] });
      continue;
    }
    cluster.items.push(item);
  }

  return clusters
    .map((cluster) => ({
      y: cluster.y,
      items: cluster.items.sort((a, b) => a.x - b.x)
    }))
    .sort((a, b) => b.y - a.y);
}

function splitRowItemsByLargeXGaps(items: PdfTextItem[], pageWidth: number) {
  if (items.length <= 1) return [items];

  const sorted = [...items].sort((a, b) => a.x - b.x);
  const gapThreshold = Math.max(110, Math.min(220, pageWidth * 0.18));
  const segments: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const xGap = next.x - prev.x;
    if (xGap > gapThreshold) {
      segments.push(current);
      current = [next];
      continue;
    }
    current.push(next);
  }

  if (current.length) segments.push(current);
  return segments;
}

function buildColumnBoundaries(columns: number[], twmColumn: number | null, pageWidth: number) {
  const sorted = [...columns].sort((a, b) => a - b);
  const boundaries: number[] = [];
  const leadingGap = sorted.length > 1 ? Math.max(20, (sorted[1] - sorted[0]) * 0.5) : 28;
  boundaries.push(Math.max(0, sorted[0] - leadingGap));

  for (let i = 1; i < sorted.length; i += 1) {
    boundaries.push((sorted[i - 1] + sorted[i]) / 2);
  }

  const defaultTrailingGap = sorted.length > 1 ? Math.max(26, (sorted[sorted.length - 1] - sorted[sorted.length - 2]) * 0.8) : 48;
  const trailingBoundary = twmColumn && twmColumn > sorted[sorted.length - 1]
    ? (sorted[sorted.length - 1] + twmColumn) / 2
    : Math.min(pageWidth - 2, sorted[sorted.length - 1] + defaultTrailingGap);
  boundaries.push(trailingBoundary);

  return boundaries;
}

function getColumnIndexForX(x: number, boundaries: number[]) {
  if (!Number.isFinite(x)) return -1;
  if (boundaries.length < 2) return -1;
  if (x < boundaries[0] || x >= boundaries[boundaries.length - 1]) return -1;
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    if (x >= boundaries[i] && x < boundaries[i + 1]) return i;
  }
  return -1;
}

function isLikelyFootnoteOnly(text: string) {
  const t = normalizeWhitespace(text);
  if (!t) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  if (/^[\[(]?\d{1,2}[\])]?$/.test(t)) return true;
  if (/^[★♥]+$/.test(t)) return true;
  return false;
}

function isRepeatedTableHeaderRow(cells: string[]) {
  const canonical = cells
    .map((cell) => canonicalizeTableLabel(cell))
    .filter((label): label is string => Boolean(label));
  if (!canonical.length) return false;
  const names = new Set(canonical);
  return TABLE_LABELS.every((label) => names.has(label));
}

function findTableHeader(items: PdfTextItem[]) {
  const labels = items
    .map((item) => ({
      item,
      canonical: canonicalizeTableLabel(item.str)
    }))
    .filter((entry): entry is { item: PdfTextItem; canonical: string } => Boolean(entry.canonical));
  const mondayRows = labels.filter((entry) => entry.canonical === 'MONDAY');

  for (const monday of mondayRows) {
    const row = labels.filter((entry) => Math.abs(entry.item.y - monday.item.y) <= 2);
    const names = new Set(row.map((entry) => entry.canonical));
    if (!TABLE_LABELS.every((label) => names.has(label))) continue;

    // Intentionally ignore trailing summary columns like TWM (total weekly mileage).
    // Parsing anchors only map to WEEK + weekday columns.
    const columns = TABLE_LABELS.map((label) => {
      const candidates = row
        .filter((entry) => entry.canonical === label)
        .sort((a, b) => a.item.x - b.item.x);
      return candidates[0]?.item.x ?? 0;
    });

    const twmCandidates = row
      .filter((entry) => entry.canonical === 'TWM')
      .sort((a, b) => a.item.x - b.item.x);

    const twmColumn = twmCandidates[0]?.item.x ?? null;
    return { y: monday.item.y, columns, twmColumn } as TableHeader;
  }

  return null;
}

function createWeekDayBuckets(): WeekDayBuckets {
  return DAY_KEYS.reduce((acc, day) => {
    acc[day] = [];
    return acc;
  }, {} as WeekDayBuckets);
}

function ensureWeekBucket(weeks: Map<number, WeekDayBuckets>, weekNumber: number) {
  if (!weeks.has(weekNumber)) {
    weeks.set(weekNumber, createWeekDayBuckets());
  }
  return weeks.get(weekNumber)!;
}

function dayKeyFromLabel(label: string): string | null {
  const normalized = normalizePlanText(label || '').toLowerCase().trim();
  const dayNumber = normalized.match(/^day\s*([1-7])$/i);
  if (dayNumber) {
    const index = Number(dayNumber[1]) - 1;
    return DAY_KEYS[index] || null;
  }

  const canonical = canonicalizeTableLabel(normalized);
  if (!canonical) return null;
  const dayIndex = DAY_LABELS.indexOf(canonical);
  if (dayIndex < 0) return null;
  return DAY_KEYS[dayIndex];
}

function extractDaySegmentsFromLine(line: string): DayTextSegment[] {
  const text = normalizeWhitespace(line);
  if (!text) return [];

  const markerRegex = /\b(Day\s*[1-7]|[A-Za-zÀ-ÿ]{2,12})\b\s*:\s*/gi;
  const validMarkers = [...text.matchAll(markerRegex)]
    .map((match) => {
      const label = match[1] || '';
      const dayKey = dayKeyFromLabel(label);
      return {
        index: match.index ?? -1,
        marker: match[0] || '',
        dayKey
      };
    })
    .filter((marker) => marker.index >= 0 && marker.dayKey);

  if (validMarkers.length > 0) {
    return validMarkers.map((marker, index) => {
      const start = marker.index + marker.marker.length;
      const end = index + 1 < validMarkers.length ? validMarkers[index + 1].index : text.length;
      return {
        dayKey: marker.dayKey as string,
        content: normalizeWhitespace(text.slice(start, end))
      };
    });
  }

  const lineStartMarker = text.match(/^(?:[-*•]\s*)?(Day\s*[1-7]|[A-Za-zÀ-ÿ]{2,12})\b\.?\s*(?:[:\-]\s*)?(.*)$/i);
  if (!lineStartMarker) return [];
  const dayKey = dayKeyFromLabel(lineStartMarker[1] || '');
  if (!dayKey) return [];

  return [{
    dayKey,
    content: normalizeWhitespace(lineStartMarker[2] || '')
  }];
}

function extractWeekHeading(line: string) {
  const text = normalizeWhitespace(line);
  if (!text) return null;

  const explicit = text.match(/^(?:week|wk|woche|semaine|semana|sem)\s*[:#-]?\s*(\d{1,2})\b[.:;\-]?\s*(.*)$/i);
  if (explicit) {
    return {
      weekNumber: Number(explicit[1]),
      remainder: normalizeWhitespace(explicit[2] || '')
    };
  }

  const weekNumber = extractWeekNumber(text);
  if (!weekNumber) return null;
  if (!/\b(?:week|wk|woche|semaine|semana|sem)\b/i.test(normalizePlanText(text))) return null;

  const remainder = normalizeWhitespace(
    text.replace(/^(?:.*?\b(?:week|wk|woche|semaine|semana|sem)\b\s*[:#-]?\s*\d{1,2}\b[.:;\-]?)/i, '')
  );
  return { weekNumber, remainder };
}

function buildParsedWeeks(weeks: Map<number, WeekDayBuckets>) {
  return [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekNumber, dayValues]) => ({
      week_number: weekNumber,
      days: DAY_KEYS.reduce((acc, day) => {
        const raw = normalizeWhitespace((dayValues[day] || []).join(' '))
          .replace(/\b([A-Za-z]+)-([A-Za-z]+)\b/g, '$1$2');
        acc[day] = { raw };
        return acc;
      }, {} as Record<string, { raw: string }>)
    }));
}

function hasStrongImplicitWeekSignal(daySequence: string[]) {
  if (!daySequence.length) return false;
  const deduped = daySequence.filter((day, index) => index === 0 || day !== daySequence[index - 1]);
  const uniqueDays = new Set(deduped);
  if (uniqueDays.size >= 5) return true;
  for (let i = 0; i <= deduped.length - 3; i += 1) {
    if (deduped[i] === 'monday' && deduped[i + 1] === 'tuesday' && deduped[i + 2] === 'wednesday') {
      return true;
    }
  }
  return false;
}

async function parseTextStructuredWeeks(pdf: any) {
  const weeks = new Map<number, WeekDayBuckets>();
  const diagnostics: TextFallbackDiagnostics = {
    pagesScanned: pdf.numPages,
    rowClusters: 0,
    weekMarkersFound: 0,
    dayMarkersFound: 0,
    linesAssigned: 0,
    continuationLines: 0,
    linesDroppedNoWeek: 0,
    linesDroppedNoDay: 0
  };

  let activeWeek: number | null = null;
  let activeDay: string | null = null;
  let nextImplicitWeek = 1;
  let pendingImplicitActiveDay: string | null = null;
  let pendingImplicitLines: PendingImplicitLine[] = [];
  let pendingImplicitDaySequence: string[] = [];

  const resetPendingImplicit = () => {
    pendingImplicitActiveDay = null;
    pendingImplicitLines = [];
    pendingImplicitDaySequence = [];
  };

  const flushPendingImplicitToWeek = (weekBucket: WeekDayBuckets) => {
    for (const pending of pendingImplicitLines) {
      const content = normalizeWhitespace(pending.content || '');
      if (!content || isLikelyFootnoteOnly(content)) continue;
      weekBucket[pending.dayKey].push(content);
      diagnostics.linesAssigned += 1;
      if (pending.continuation) diagnostics.continuationLines += 1;
    }
    resetPendingImplicit();
  };

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const items: PdfTextItem[] = (textContent.items as any[])
      .map((item) => ({
        str: String(item.str || '').trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter((item) => item.str && item.y > 35);
    const pageWidth = Number((page as { view?: number[] }).view?.[2] || 1000);

    const rowTexts = clusterRows(items)
      .flatMap((cluster) => splitRowItemsByLargeXGaps(cluster.items, pageWidth)
        .map((segment) => normalizeWhitespace(segment.map((item) => item.str).join(' '))))
      .filter(Boolean);

    diagnostics.rowClusters += rowTexts.length;

    for (const rowTextValue of rowTexts) {
      let rowText = normalizeWhitespace(rowTextValue);
      if (!rowText || isLikelyFootnoteOnly(rowText)) continue;
      if (/^(?:page\s*)?\d+\s*(?:of\s*\d+)?$/i.test(rowText)) continue;

      const weekHeading = extractWeekHeading(rowText);
      if (weekHeading) {
        resetPendingImplicit();
        activeWeek = weekHeading.weekNumber;
        nextImplicitWeek = Math.max(nextImplicitWeek, activeWeek + 1);
        ensureWeekBucket(weeks, activeWeek);
        diagnostics.weekMarkersFound += 1;
        activeDay = null;
        rowText = weekHeading.remainder;
        if (!rowText) continue;
      }

      const daySegments = extractDaySegmentsFromLine(rowText);
      if (daySegments.length > 0) {
        if (!activeWeek) {
          for (const segment of daySegments) {
            diagnostics.dayMarkersFound += 1;
            pendingImplicitActiveDay = segment.dayKey;
            pendingImplicitDaySequence.push(segment.dayKey);
            const content = normalizeWhitespace(segment.content);
            if (!content || isLikelyFootnoteOnly(content)) continue;
            pendingImplicitLines.push({
              dayKey: segment.dayKey,
              content,
              continuation: false
            });
          }

          if (hasStrongImplicitWeekSignal(pendingImplicitDaySequence)) {
            activeWeek = nextImplicitWeek;
            nextImplicitWeek += 1;
            const promotedActiveDay = pendingImplicitActiveDay;
            const weekBucket = ensureWeekBucket(weeks, activeWeek);
            flushPendingImplicitToWeek(weekBucket);
            activeDay = promotedActiveDay;
          }
          continue;
        }

        const weekBucket = ensureWeekBucket(weeks, activeWeek);
        let assignedInLine = 0;
        for (const segment of daySegments) {
          diagnostics.dayMarkersFound += 1;
          activeDay = segment.dayKey;
          const content = normalizeWhitespace(segment.content);
          if (!content || isLikelyFootnoteOnly(content)) continue;
          weekBucket[segment.dayKey].push(content);
          assignedInLine += 1;
        }
        if (assignedInLine > 0) diagnostics.linesAssigned += 1;
        continue;
      }

      if (!activeWeek) {
        if (pendingImplicitActiveDay) {
          pendingImplicitLines.push({
            dayKey: pendingImplicitActiveDay,
            content: rowText,
            continuation: true
          });
          continue;
        }
        diagnostics.linesDroppedNoWeek += 1;
        continue;
      }
      if (!activeDay) {
        diagnostics.linesDroppedNoDay += 1;
        continue;
      }

      const weekBucket = ensureWeekBucket(weeks, activeWeek);
      weekBucket[activeDay].push(rowText);
      diagnostics.linesAssigned += 1;
      diagnostics.continuationLines += 1;
    }
  }

  return { weeks, diagnostics };
}

async function parsePdfToJsonNode(pdfPath: string, name: string): Promise<ParsedPlanOutput> {
  const bytes = await fs.readFile(pdfPath);
  const workerPath = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  );
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const loadingTask = (pdfjsLib as any).getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true
  });
  const pdf = await loadingTask.promise;
  const weeks = new Map<number, Record<string, string[]>>();
  const tableDiagnostics = {
    pagesScanned: pdf.numPages,
    pagesWithHeader: 0,
    rowClusters: 0,
    rowsAssigned: 0,
    rowsDroppedNoWeek: 0,
    rowsDroppedHeader: 0,
    weekMarkersFound: 0,
    tokenTotal: 0,
    tokenAssigned: 0
  };
  let carryWeekNumber: number | null = null;

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const items: PdfTextItem[] = (textContent.items as any[])
      .map((item) => ({
        str: String(item.str || '').trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter((item) => item.str);

    const header = findTableHeader(items);
    if (!header) continue;
    tableDiagnostics.pagesWithHeader += 1;
    const pageWidth = Number((page as { view?: number[] }).view?.[2] || 1000);
    const boundaries = buildColumnBoundaries(header.columns, header.twmColumn, pageWidth);

    const bodyItems = items.filter((item) => (
      item.y < header.y - 3
      && item.y > 55
      && item.x >= boundaries[0] - 4
      && item.x < boundaries[boundaries.length - 1] + 4
    ));

    const rows = clusterRows(bodyItems).map((cluster) => {
      const cellParts: string[][] = Array.from({ length: 8 }, () => []);
      let assignedCount = 0;

      for (const item of cluster.items) {
        tableDiagnostics.tokenTotal += 1;
        const columnIndex = getColumnIndexForX(item.x, boundaries);
        if (columnIndex < 0 || columnIndex >= cellParts.length) continue;
        cellParts[columnIndex].push(item.str);
        assignedCount += 1;
        tableDiagnostics.tokenAssigned += 1;
      }

      return {
        y: cluster.y,
        cells: cellParts.map((parts) => normalizeWhitespace(parts.join(' '))),
        assignedCount
      };
    }).filter((row) => row.cells.some(Boolean));

    tableDiagnostics.rowClusters += rows.length;
    let activeWeek = carryWeekNumber;

    for (const row of rows) {
      if (isRepeatedTableHeaderRow(row.cells)) {
        tableDiagnostics.rowsDroppedHeader += 1;
        continue;
      }

      const weekFromCell = extractWeekNumber(row.cells[0] || '');
      if (weekFromCell) {
        activeWeek = weekFromCell;
        carryWeekNumber = weekFromCell;
        tableDiagnostics.weekMarkersFound += 1;
      }

      const dayCells = row.cells.slice(1, 1 + DAY_KEYS.length);
      if (!dayCells.some((cell) => cell.length > 0)) continue;

      if (!activeWeek) {
        tableDiagnostics.rowsDroppedNoWeek += 1;
        continue;
      }
      const weekNumber = activeWeek;

      if (!weeks.has(weekNumber)) {
        weeks.set(weekNumber, DAY_KEYS.reduce((acc, day) => {
          acc[day] = [];
          return acc;
        }, {} as Record<string, string[]>));
      }

      const bucket = weeks.get(weekNumber)!;
      let rowStored = false;
      for (let i = 0; i < DAY_KEYS.length; i += 1) {
        const cell = dayCells[i];
        if (!cell || isLikelyFootnoteOnly(cell)) continue;
        const cellLabel = canonicalizeTableLabel(cell);
        if (cellLabel && (TABLE_LABELS.includes(cellLabel) || cellLabel === 'TWM')) continue;
        bucket[DAY_KEYS[i]].push(cell);
        rowStored = true;
      }
      if (rowStored || row.assignedCount > 0) {
        tableDiagnostics.rowsAssigned += 1;
      }
    }
  }

  let parseMode: 'table' | 'text' = 'table';
  let parsedWeeks = buildParsedWeeks(weeks);
  let textFallbackDiagnostics: TextFallbackDiagnostics | null = null;

  if (!parsedWeeks.length) {
    const fallback = await parseTextStructuredWeeks(pdf);
    parsedWeeks = buildParsedWeeks(fallback.weeks);
    textFallbackDiagnostics = fallback.diagnostics;
    if (parsedWeeks.length) {
      parseMode = 'text';
    }
  }

  if (!parsedWeeks.length) {
    throw new Error('Node parser found no recognizable week/day content in this PDF.');
  }
  const programProfile = buildProgramDocumentProfile({
    planName: name,
    weeks: parsedWeeks
  });

  return {
    source_pdf: path.basename(pdfPath),
    program_name: name,
    generated_at: new Date().toISOString(),
    parser: 'node',
    parse_debug: {
      parser: 'node',
      parseMode,
      diagnostics: {
        ...(parseMode === 'table'
          ? {
            ...tableDiagnostics,
            tokenAssignmentRate: tableDiagnostics.tokenTotal > 0
              ? Number((tableDiagnostics.tokenAssigned / tableDiagnostics.tokenTotal).toFixed(3))
              : 0
          }
          : (textFallbackDiagnostics || {}))
      }
    },
    weeks: parsedWeeks,
    program_profile: programProfile,
    glossary: {
      sections: [],
      entries: {},
      review_needed: [],
      note: parseMode === 'table'
        ? 'Parsed with Node fallback parser (table mode).'
        : 'Parsed with Node fallback parser (text-structured mode).'
    }
  };
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: user.id, isTemplate: false },
    orderBy: { createdAt: 'desc' },
    include: {
      activities: {
        select: { completed: true }
      }
    }
  });

  const plansWithProgress = plans.map((plan) => {
    const total = plan.activities.length;
    const completed = plan.activities.filter((a) => a.completed).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Remove activities from the response to keep it clean, we only need the progress
    const { activities, ...rest } = plan;
    return { ...rest, progress };
  });

  return NextResponse.json({ plans: plansWithProgress });
}

async function parsePdfToJson(planId: string, pdfPath: string, name: string): Promise<ParsedPlanOutput> {
  if (process.env.VERCEL) {
    const nodeParsed = await parsePdfToJsonNode(pdfPath, name);
    const nodeQuality = scoreParsedResult(nodeParsed);
    const programProfile = nodeParsed.program_profile || buildProfileFromParsed(name, nodeParsed);
    return {
      ...nodeParsed,
      program_profile: programProfile,
      parse_meta: {
        selectedParser: 'node',
        quality: nodeQuality,
        selectedDiagnostics: (nodeParsed.parse_debug as Record<string, unknown>) || null,
        candidates: [{
          parser: 'node',
          quality: nodeQuality,
          diagnostics: (nodeParsed.parse_debug as Record<string, unknown>) || null
        }]
      }
    };
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'parse_plan_pdf.py');
  const outputDir = path.join(os.tmpdir(), 'coachplan', 'parsed');
  const outputPath = path.join(outputDir, `${planId}.json`);
  await fs.mkdir(outputDir, { recursive: true });

  let pythonParsed: ParsedPlanOutput | null = null;
  let pythonFailureReason: string | null = null;
  try {
    await execFileAsync(
      'python3',
      [
        scriptPath,
        '--input',
        pdfPath,
        '--output',
        outputPath,
        '--name',
        name
      ],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 }
    );
    const raw = await fs.readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const parsedRecord = parsed as Record<string, unknown>;
      const weeks = Array.isArray(parsedRecord.weeks) ? parsedRecord.weeks as ParsedWeekEntry[] : [];
      pythonParsed = { ...parsedRecord, weeks, parser: 'python' };
    } else {
      pythonFailureReason = 'Python parser returned an invalid JSON payload.';
    }
  } catch (error) {
    const err = error as Error & { stderr?: string; message: string };
    pythonFailureReason = err.stderr?.trim() || err.message || 'Unknown parser failure';
  }

  let nodeParsed: ParsedPlanOutput | null = null;
  let nodeFailureReason: string | null = null;
  try {
    nodeParsed = await parsePdfToJsonNode(pdfPath, name);
  } catch (nodeError) {
    nodeFailureReason = nodeError instanceof Error ? nodeError.message : 'Unknown node parser failure';
  }

  const candidates: ParseCandidate[] = [];
  if (pythonParsed) {
    candidates.push({
      parser: 'python',
      parsed: pythonParsed,
      quality: scoreParsedResult(pythonParsed)
    });
  }
  if (nodeParsed) {
    candidates.push({
      parser: 'node',
      parsed: nodeParsed,
      quality: scoreParsedResult(nodeParsed)
    });
  }

  const viable = candidates.filter((candidate) => candidate.quality.weekCount > 0);
  if (!viable.length) {
    throw new Error(
      `PDF parse failed. Python parser: ${pythonFailureReason || 'no usable output'}. Node fallback: ${nodeFailureReason || 'no usable output'}.`
    );
  }

  const selected = selectBestParseCandidate(viable);
  const programProfile = selected.parsed.program_profile || buildProfileFromParsed(name, selected.parsed);
  return {
    ...selected.parsed,
    program_profile: programProfile,
    parse_meta: {
      selectedParser: selected.parser,
      quality: selected.quality,
      selectedDiagnostics: (selected.parsed.parse_debug as Record<string, unknown>) || null,
      candidates: candidates.map((candidate) => ({
        parser: candidate.parser,
        quality: candidate.quality,
        diagnostics: (candidate.parsed.parse_debug as Record<string, unknown>) || null
      }))
    }
  };
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { units: true }
  });
  const userDefaultDistanceUnit: UnitPreference = dbUser?.units === 'KM' ? 'KM' : 'MILES';

  const contentType = req.headers.get('content-type') || '';
  let name = '';
  let raceName: string | null = null;
  let raceDate: string | null = null;
  let file: File | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    name = String(form.get('name') || '').trim();
    raceName = form.get('raceName') ? String(form.get('raceName')).trim() : null;
    raceDate = form.get('raceDate') ? String(form.get('raceDate')) : null;
    const maybeFile = form.get('file');
    if (maybeFile instanceof File) file = maybeFile;
    if (file && file.size > 0 && file.name) {
      name = planNameFromFilename(file.name);
    }
  } else {
    const body = await req.json();
    name = String(body?.name || '').trim();
    raceName = body?.raceName ? String(body.raceName).trim() : null;
    raceDate = body?.raceDate ? String(body.raceDate) : null;
  }

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const plan = await prisma.trainingPlan.create({
    data: {
      name,
      raceName: raceName || null,
      raceDate: raceDate ? new Date(raceDate) : null,
      isTemplate: false,
      status: 'DRAFT',
      ownerId: user.id,
      athleteId: user.id
    }
  });

  let parseWarning: string | null = null;
  if (file && file.size > 0) {
    const uploadDir = path.join(os.tmpdir(), 'coachplan', 'uploads');

    try {
      await fs.mkdir(uploadDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
      await prisma.planSourceDocument.upsert({
        where: { planId: plan.id },
        create: {
          planId: plan.id,
          fileName: file.name || `${name}.pdf`,
          mimeType: file.type || 'application/pdf',
          fileSize: buffer.byteLength,
          checksumSha256,
          content: buffer
        },
        update: {
          fileName: file.name || `${name}.pdf`,
          mimeType: file.type || 'application/pdf',
          fileSize: buffer.byteLength,
          checksumSha256,
          content: buffer
        }
      });
      const pdfPath = path.join(uploadDir, `${plan.id}.pdf`);
      await fs.writeFile(pdfPath, buffer);

      // Parser V4: run first, always awaited.
      const v4Data = await maybeRunParserV4(buffer, plan.id);

      // When V4 is primary and returned validated data, use it to populate the plan
      // and skip the legacy per-week parser entirely.
      if (FLAGS.PARSER_V4_PRIMARY && v4Data) {
        const { weeksCreated, activitiesCreated } = await populatePlanFromV4(plan.id, v4Data);
        console.info('[ParserV4] Primary mode: populated plan from V4', {
          planId: plan.id,
          weeksCreated,
          activitiesCreated
        });
        if (raceDate && weeksCreated > 0) {
          const parsedRaceDate = new Date(raceDate);
          if (!Number.isNaN(parsedRaceDate.getTime())) {
            await alignWeeksToRaceDate(plan.id, weeksCreated, parsedRaceDate);
          }
        }
      }

      // Pass 1: Extract plan guide from full PDF text for context-aware week parsing.
      // This runs async and never blocks the upload — failures are swallowed inside extractPlanGuide.
      let planGuide = '';
      if (ENABLE_AI_WEEK_PARSE) {
        try {
          const { fullText: pdfFullText } = await extractPdfText(buffer);
          planGuide = await extractPlanGuide(pdfFullText);
        } catch {
          planGuide = '';
        }
        if (planGuide) {
          try {
            await prisma.trainingPlan.update({
              where: { id: plan.id },
              data: { planGuide }
            });
          } catch (guideErr) {
            console.error('[extractPlanGuide] Failed to save planGuide (non-fatal):', guideErr instanceof Error ? guideErr.message : String(guideErr));
          }
        }
      }

      if (!(FLAGS.PARSER_V4_PRIMARY && v4Data)) {

      const parsed = await withTimeout(
        parsePdfToJson(plan.id, pdfPath, name),
        UPLOAD_PARSE_TIMEOUT_MS,
        'PDF parse timed out. Please try a smaller/simpler PDF.'
      );
      const parseMeta = parsed && typeof parsed === 'object'
        ? (parsed as {
          parse_meta?: {
            selectedParser?: string;
            quality?: ParseQuality;
            selectedDiagnostics?: Record<string, unknown> | null;
            candidates?: Array<{
              parser: string;
              quality: ParseQuality;
              diagnostics?: Record<string, unknown> | null;
            }>;
          };
        }).parse_meta
        : undefined;
      const parseQuality = parseMeta?.quality || scoreParsedResult(parsed);
      const selectedParser = parseMeta?.selectedParser
        || (typeof (parsed as { parser?: unknown })?.parser === 'string' ? String((parsed as { parser?: unknown }).parser) : 'unknown');
      if (
        parseQuality.weekCount === 0
        || parseQuality.score < PARSE_MIN_QUALITY_SCORE
        || parseQuality.dayCoverage < PARSE_MIN_DAY_COVERAGE
      ) {
        throw new Error(
          `Parsed content confidence too low (parser=${selectedParser}, score=${parseQuality.score}, weekCount=${parseQuality.weekCount}, dayCoverage=${parseQuality.dayCoverage.toFixed(2)}).`
        );
      }
      console.info('Plan parse quality', {
        planId: plan.id,
        parser: selectedParser,
        quality: parseQuality,
        diagnostics: parseMeta?.selectedDiagnostics || null,
        candidates: parseMeta?.candidates || null
      });
      const weeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];
      const parsedProgramProfile = (parsed as { program_profile?: unknown })?.program_profile;
      const programProfile = parsedProgramProfile && typeof parsedProgramProfile === 'object'
        ? parsedProgramProfile as ProgramDocumentProfile
        : buildProgramDocumentProfile({ planName: name, weeks });

      const weekRecords: { id: string }[] = [];
      for (let i = 0; i < weeks.length; i += 1) {
        weekRecords.push(
          await prisma.planWeek.create({
            data: {
              planId: plan.id,
              weekIndex: i + 1
            }
          })
        );
      }

      const activities: any[] = [];
      const aiEnrichmentStartedAt = Date.now();
      let aiBudgetExceeded = false;
      for (let i = 0; i < weeks.length; i += 1) {
        const week = weeks[i];
        const weekId = weekRecords[i]?.id;
        const rawDays: Record<string, string> = {};
        DAY_KEYS.forEach((key) => {
          rawDays[key] = week?.days?.[key]?.raw || '';
        });
        const weekDefaultDistanceUnit = inferDominantDistanceUnit(Object.values(rawDays), userDefaultDistanceUnit);
        const aiTargetDayKeys = ENABLE_AI_WEEK_PARSE
          ? selectAiTargetDayKeys(rawDays, AI_WEEK_PARSE_MAX_DAYS)
          : [];
        const aiTargetSet = new Set(aiTargetDayKeys);

        let aiWeek = null;
        const aiElapsedMs = Date.now() - aiEnrichmentStartedAt;
        const aiBudgetRemainingMs = Math.max(0, AI_WEEK_PARSE_TOTAL_BUDGET_MS - aiElapsedMs);
        const canRunAiWeekParse = ENABLE_AI_WEEK_PARSE && aiTargetDayKeys.length > 0 && aiBudgetRemainingMs >= 1200;
        if (canRunAiWeekParse) {
          const aiInputDays: Record<string, string> = {};
          DAY_KEYS.forEach((key) => {
            aiInputDays[key] = aiTargetSet.has(key) ? rawDays[key] : '';
          });
          try {
            aiWeek = await withTimeout(
              parseWeekWithAI({
                planName: name,
                weekNumber: i + 1,
                days: aiInputDays,
                legend: parsed?.glossary?.note || undefined,
                planGuide: planGuide || undefined,
                programProfile,
                model: AI_WEEK_PARSE_MODEL
              }),
              Math.min(AI_WEEK_PARSE_TIMEOUT_MS, aiBudgetRemainingMs),
              'AI week parse timed out.'
            );
          } catch {
            aiWeek = null;
          }
        } else if (ENABLE_AI_WEEK_PARSE && aiTargetDayKeys.length > 0) {
          aiBudgetExceeded = true;
        }

        for (let d = 0; d < DAY_KEYS.length; d += 1) {
          const key = DAY_KEYS[d];
          const entry = week?.days?.[key];
          if (!entry) continue;

          const day = await prisma.planDay.create({
            data: {
              planId: plan.id,
              weekId,
              dayOfWeek: d + 1,
              rawText: entry.raw || null
            }
          });
          const dayDefaultDistanceUnit = inferDominantDistanceUnit(
            [entry.raw || '', ...Object.values(rawDays)],
            weekDefaultDistanceUnit
          );

          const aiActivities = aiTargetSet.has(key)
            ? (aiWeek?.days?.[key]?.activities || [])
            : [];
          const deterministicActivities = buildDeterministicActivities({
            planId: plan.id,
            dayId: day.id,
            entry,
            inferredDistanceUnit: dayDefaultDistanceUnit,
            storageDistanceUnit: userDefaultDistanceUnit
          });
          const aiDrafts = aiActivities.length
            ? buildAiActivities({
              planId: plan.id,
              dayId: day.id,
              dayRawText: entry.raw || '',
              aiActivities,
              inferredDistanceUnit: dayDefaultDistanceUnit,
              storageDistanceUnit: userDefaultDistanceUnit
            })
            : [];
          const mergedActivities = aiDrafts.length
            ? mergeDayActivitiesWithAI(deterministicActivities, aiDrafts)
            : deterministicActivities;
          activities.push(...mergedActivities.map((activity) => withStructuredIntensityTargets(activity)));
        }
      }

      if (activities.length) {
        await prisma.planActivity.createMany({ data: activities });
      }

      await prisma.trainingPlan.update({
        where: { id: plan.id },
        data: {
          weekCount: weeks.length || null,
          parseProfile: programProfile,
          status: 'DRAFT'
        }
      });

      if (raceDate && weeks.length > 0) {
        const parsedRaceDate = new Date(raceDate);
        if (!Number.isNaN(parsedRaceDate.getTime())) {
          await alignWeeksToRaceDate(plan.id, weeks.length, parsedRaceDate);
        }
      }
      if (aiBudgetExceeded) {
        console.info('AI enrichment budget reached; remaining weeks will use deterministic parser only.', {
          planId: plan.id,
          budgetMs: AI_WEEK_PARSE_TOTAL_BUDGET_MS
        });
      }
      } // end if (legacy parser path)
    } catch (error) {
      const reason = (error as Error).message || 'Unknown parser error';
      parseWarning = reason;
      console.error('Plan parse failed, creating fallback editable skeleton', { planId: plan.id, reason });

      const existingWeeks = await prisma.planWeek.count({ where: { planId: plan.id } });
      if (existingWeeks === 0) {
        const fallbackWeek = await prisma.planWeek.create({
          data: {
            planId: plan.id,
            weekIndex: 1
          }
        });

        await prisma.planDay.createMany({
          data: Array.from({ length: 7 }).map((_, idx) => ({
            planId: plan.id,
            weekId: fallbackWeek.id,
            dayOfWeek: idx + 1,
            rawText: idx === 0
              ? 'Parser fallback mode: add/edit activities manually for this plan.'
              : null
          }))
        });

        await prisma.trainingPlan.update({
          where: { id: plan.id },
          data: {
            weekCount: 1,
            status: 'DRAFT'
          }
        });
      }
    }
  }

  const latestPlan = await prisma.trainingPlan.findUnique({
    where: { id: plan.id }
  });

  return NextResponse.json({
    plan: latestPlan || plan,
    parseWarning
  });
}
