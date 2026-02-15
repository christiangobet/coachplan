import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseWeekWithAI } from '@/lib/ai-plan-parser';
import { alignWeeksToRaceDate } from '@/lib/clone-plan';
import { canonicalizeTableLabel, extractWeekNumber, normalizePlanText } from '@/lib/plan-parser-i18n.mjs';
import { hasConfiguredAiProvider } from '@/lib/openai';
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

const UPLOAD_PARSE_TIMEOUT_MS = parseTimeoutMs(process.env.UPLOAD_PARSE_TIMEOUT_MS, 120000);
const AI_WEEK_PARSE_TIMEOUT_MS = parseTimeoutMs(process.env.AI_WEEK_PARSE_TIMEOUT_MS, 8000);

const RUN_SUBTYPES = new Set([
  'tempo',
  'hills',
  'hill-pyramid',
  'incline-treadmill',
  'progression',
  'trail-run',
  'recovery',
  'easy-run',
  'training-race',
  'race',
  'fast-finish',
  'lrl',
  'unknown'
]);

const SUBTYPE_TITLES: Record<string, string> = {
  'lrl': 'Long Run',
  'easy-run': 'Easy Run',
  'tempo': 'Tempo Run',
  'hills': 'Hill Workout',
  'hill-pyramid': 'Hill Pyramid',
  'incline-treadmill': 'Incline Treadmill',
  'progression': 'Progression Run',
  'trail-run': 'Trail Run',
  'recovery': 'Recovery Run',
  'fast-finish': 'Fast Finish',
  'training-race': 'Training Race',
  'race': 'Race',
  'strength': 'Strength',
  'cross-training': 'Cross Training',
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
  if (token === 'long-run' || token === 'lr' || token === 'lrl') return 'lrl';
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
  if (subtype === 'yoga') return 'OTHER';
  if (RUN_SUBTYPES.has(subtype)) return 'RUN';
  return 'OTHER';
}

function mapAiTypeToActivityType(type: string | null | undefined) {
  if (type === 'run') return 'RUN';
  if (type === 'strength') return 'STRENGTH';
  if (type === 'cross_train') return 'CROSS_TRAIN';
  if (type === 'rest') return 'REST';
  if (type === 'hike') return 'HIKE';
  return 'OTHER';
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
  distance: number | null;
  distanceUnit: 'MILES' | 'KM' | null;
  duration: number | null;
  paceTarget?: string | null;
  effortTarget?: string | null;
  structure?: any;
  tags?: any;
  priority: string | null;
  bailAllowed: boolean;
  mustDo: boolean;
};

function ensureDistanceConsistency(activity: ActivityDraft): ActivityDraft {
  if (activity.distance === null || activity.distanceUnit === null) {
    return { ...activity, distance: null, distanceUnit: null };
  }
  return activity;
}

function normalizeMatchText(text: string | null | undefined) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    rawText: base.rawText || ai.rawText || null,
    distance: base.distance ?? ai.distance,
    distanceUnit: base.distanceUnit ?? ai.distanceUnit,
    duration: base.duration ?? ai.duration,
    paceTarget: base.paceTarget ?? ai.paceTarget ?? null,
    effortTarget: base.effortTarget ?? ai.effortTarget ?? null,
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
    const decodedRawText = decodeActivityText(String(a.raw_text || dayRawText || ''));
    const normalizedSubtype = normalizeSubtypeToken(a.subtype || null);
    const inferredSubtype = inferSubtype(decodedRawText || String(a.title || ''));
    const effectiveSubtype =
      normalizedSubtype && normalizedSubtype !== 'unknown'
        ? normalizedSubtype
        : inferredSubtype !== 'unknown'
          ? inferredSubtype
          : null;
    const aiType = mapAiTypeToActivityType(a.type || null);
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
    const fallbackTitle = effectiveSubtype
      ? SUBTYPE_TITLES[effectiveSubtype] || titleCase(effectiveSubtype)
      : 'Workout';
    drafts.push(ensureDistanceConsistency({
      planId,
      dayId,
      type: aiType,
      subtype: effectiveSubtype,
      title: normalizedTitle || fallbackTitle,
      rawText: decodedRawText || null,
      distance: storageDistance.distance,
      distanceUnit: storageDistance.distanceUnit,
      duration: aiDuration,
      paceTarget: a.metrics?.pace_target ?? null,
      effortTarget: a.metrics?.effort_target ?? null,
      structure: a.structure || null,
      tags: a.tags || null,
      priority: a.priority ? String(a.priority).toUpperCase() : null,
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

function stripSuperscriptFootnotes(text: string) {
  return text
    // Superscript/subscript unicode blocks commonly used for footnote markers in PDFs.
    .replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]/g, '')
    // Common standalone footnote symbols.
    .replace(/[†‡§¶‖※]/g, ' ')
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

function nearestIndex(target: number, anchors: number[]) {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.length; i += 1) {
    const dist = Math.abs(target - anchors[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distance: bestDist };
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

    const columns = TABLE_LABELS.map((label) => {
      const candidates = row
        .filter((entry) => entry.canonical === label)
        .sort((a, b) => a.item.x - b.item.x);
      return candidates[0]?.item.x ?? 0;
    });

    return { y: monday.item.y, columns };
  }

  return null;
}

async function parsePdfToJsonNode(pdfPath: string, name: string) {
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

    const bodyItems = items.filter((item) => (
      item.y < header.y - 3
      && item.y > 70
      && item.x < 740
    ));

    const rows = clusterRows(bodyItems).map((cluster) => {
      const cellParts: string[][] = Array.from({ length: 8 }, () => []);

      for (const item of cluster.items) {
        const nearest = nearestIndex(item.x, header.columns);
        if (nearest.distance > 75) continue;
        cellParts[nearest.index].push(item.str);
      }

      return {
        y: cluster.y,
        cells: cellParts.map((parts) => normalizeWhitespace(parts.join(' ')))
      };
    }).filter((row) => row.cells.some(Boolean));

    const markers = rows
      .map((row) => {
        const week = extractWeekNumber(row.cells[0] || '');
        if (!week) return null;
        return { y: row.y, week };
      })
      .filter((marker): marker is { y: number; week: number } => Boolean(marker));

    if (!markers.length) continue;

    for (const row of rows) {
      const dayCells = row.cells.slice(1);
      if (!dayCells.some((cell) => cell.length > 0)) continue;

      const nearestMarker = markers.reduce((best, marker) => {
        if (!best) return marker;
        return Math.abs(marker.y - row.y) < Math.abs(best.y - row.y) ? marker : best;
      }, null as { y: number; week: number } | null);

      if (!nearestMarker) continue;
      const weekNumber = nearestMarker.week;

      if (!weeks.has(weekNumber)) {
        weeks.set(weekNumber, DAY_KEYS.reduce((acc, day) => {
          acc[day] = [];
          return acc;
        }, {} as Record<string, string[]>));
      }

      const bucket = weeks.get(weekNumber)!;
      for (let i = 0; i < DAY_KEYS.length; i += 1) {
        const cell = dayCells[i];
        if (!cell) continue;
        bucket[DAY_KEYS[i]].push(cell);
      }
    }
  }

  const parsedWeeks = [...weeks.entries()]
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

  if (!parsedWeeks.length) {
    throw new Error('Node parser found no recognizable week/day table in this PDF.');
  }

  return {
    source_pdf: path.basename(pdfPath),
    program_name: name,
    generated_at: new Date().toISOString(),
    weeks: parsedWeeks,
    glossary: {
      sections: [],
      entries: {},
      review_needed: [],
      note: 'Parsed with Node fallback parser.'
    }
  };
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: user.id, isTemplate: false },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json({ plans });
}

async function parsePdfToJson(planId: string, pdfPath: string, name: string) {
  if (process.env.VERCEL) {
    return parsePdfToJsonNode(pdfPath, name);
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'parse_plan_pdf.py');
  const outputDir = path.join(os.tmpdir(), 'coachplan', 'parsed');
  const outputPath = path.join(outputDir, `${planId}.json`);
  await fs.mkdir(outputDir, { recursive: true });

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
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.weeks) && parsed.weeks.length > 0) {
      return parsed;
    }
    pythonFailureReason = 'Python parser produced no recognizable weeks.';
  } catch (error) {
    const err = error as Error & { stderr?: string; message: string };
    pythonFailureReason = err.stderr?.trim() || err.message || 'Unknown parser failure';
  }

  try {
    return await parsePdfToJsonNode(pdfPath, name);
  } catch (nodeError) {
    const nodeReason = nodeError instanceof Error ? nodeError.message : 'Unknown node parser failure';
    throw new Error(`PDF parse failed. Python parser: ${pythonFailureReason || 'unknown error'}. Node fallback: ${nodeReason}`);
  }
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
      const pdfPath = path.join(uploadDir, `${plan.id}.pdf`);
      await fs.writeFile(pdfPath, buffer);

      const parsed = await withTimeout(
        parsePdfToJson(plan.id, pdfPath, name),
        UPLOAD_PARSE_TIMEOUT_MS,
        'PDF parse timed out. Please try a smaller/simpler PDF.'
      );
      const weeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];

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
      for (let i = 0; i < weeks.length; i += 1) {
        const week = weeks[i];
        const weekId = weekRecords[i]?.id;
        const rawDays: Record<string, string> = {};
        DAY_KEYS.forEach((key) => {
          rawDays[key] = week?.days?.[key]?.raw || '';
        });
        const weekDefaultDistanceUnit = inferDominantDistanceUnit(Object.values(rawDays), userDefaultDistanceUnit);

        let aiWeek = null;
        if (ENABLE_AI_WEEK_PARSE) {
          try {
            aiWeek = await withTimeout(
              parseWeekWithAI({
                planName: name,
                weekNumber: i + 1,
                days: rawDays,
                legend: parsed?.glossary?.note || undefined
              }),
              AI_WEEK_PARSE_TIMEOUT_MS,
              'AI week parse timed out.'
            );
          } catch {
            aiWeek = null;
          }
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

          const aiActivities = aiWeek?.days?.[key]?.activities || [];
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
          activities.push(...mergedActivities);
        }
      }

      if (activities.length) {
        await prisma.planActivity.createMany({ data: activities });
      }

      await prisma.trainingPlan.update({
        where: { id: plan.id },
        data: {
          weekCount: weeks.length || null,
          status: 'DRAFT'
        }
      });

      if (raceDate && weeks.length > 0) {
        const parsedRaceDate = new Date(raceDate);
        if (!Number.isNaN(parsedRaceDate.getTime())) {
          await alignWeeksToRaceDate(plan.id, weeks.length, parsedRaceDate);
        }
      }
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
