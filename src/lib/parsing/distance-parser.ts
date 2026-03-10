import { normalizePlanText } from '@/lib/plan-parser-i18n.mjs';

export type DistanceParseResult = {
  distance: number | null;
  distanceUnit: 'MILES' | 'KM' | null;
};

export type UnitPreference = 'MILES' | 'KM';

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function asUpperDistanceUnit(token: unknown): 'MILES' | 'KM' | 'M' | null {
  if (!token || typeof token !== 'string') return null;
  const unit = token.trim().toLowerCase();
  if (unit === 'mile' || unit === 'miles' || unit === 'mi') return 'MILES';
  if (unit === 'km' || unit === 'kms' || unit === 'kilometer' || unit === 'kilometre' || unit === 'kilometers' || unit === 'kilometres') return 'KM';
  if (unit === 'm' || unit === 'meter' || unit === 'metre' || unit === 'meters' || unit === 'metres') return 'M';
  return null;
}

export function hasMetersNotation(text: string) {
  const t = normalizePlanText(text).toLowerCase();
  if (/\d+(?:\.\d+)?\s*(?:meters?|metres?)\b/.test(t)) return true;
  if (/\b(?:reps?|strides?|interval)\b/.test(t) && /\d{2,4}\s*m\b/.test(t)) return true;
  return /\d{3,4}\s*m\b/.test(t);
}

export function inferDistanceUnitFromText(text: string): 'MILES' | 'KM' | 'M' | null {
  const t = normalizePlanText(text).toLowerCase();
  if (/\d+(?:\.\d+)?\s*(?:miles?|mile|mi)\b/.test(t)) return 'MILES';
  if (/\d+(?:\.\d+)?\s*(?:km|kms|kilometers?|kilometres?)\b/.test(t)) return 'KM';
  if (hasMetersNotation(t)) return 'M';
  return null;
}

export function normalizeDistanceValue(distance: number | null, unit: 'MILES' | 'KM' | 'M' | null): DistanceParseResult {
  if (distance === null || !Number.isFinite(distance) || distance <= 0 || !unit) {
    return { distance: null, distanceUnit: null };
  }
  if (unit === 'M') {
    return { distance: distance / 1000, distanceUnit: 'KM' };
  }
  return { distance, distanceUnit: unit };
}

export function convertDistanceValue(value: number, from: UnitPreference, to: UnitPreference) {
  if (from === to) return value;
  if (from === 'MILES' && to === 'KM') return value * 1.609344;
  return value / 1.609344;
}

export function convertDistanceToStorageUnit(distance: DistanceParseResult, storageUnit: UnitPreference): DistanceParseResult {
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

export function resolveDistanceFromValueUnit(
  distanceCandidate: unknown,
  unitCandidate: unknown,
  rawText: string
): DistanceParseResult {
  const numeric = parseNumber(distanceCandidate);
  let unit = asUpperDistanceUnit(unitCandidate);
  if (!unit) unit = inferDistanceUnitFromText(rawText);
  return normalizeDistanceValue(numeric, unit);
}

export function resolveDistanceFromSegmentMetrics(metrics: Record<string, unknown>, rawText: string): DistanceParseResult {
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

export function inferDominantDistanceUnit(texts: string[], fallback: UnitPreference): UnitPreference {
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

export function resolveImpliedRunDistanceFromText(rawText: string, defaultUnit: UnitPreference | null): DistanceParseResult {
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

export function resolveDistanceFromText(rawText: string, defaultUnit: UnitPreference | null = null): DistanceParseResult {
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

export function parseRange(value: string) {
  const parts = value.split('-').map((v) => Number(v.trim()));
  if (parts.length === 2 && parts.every((v) => !Number.isNaN(v))) {
    return { min: parts[0], max: parts[1] };
  }
  const single = Number(value);
  if (!Number.isNaN(single)) return { min: single, max: single };
  return null;
}

export function extractDistanceRange(text: string, patterns: RegExp[]) {
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

export function parseStructure(text: string) {
  const normalizedText = normalizePlanText(text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export function resolveDistanceFromStructure(structure: any): DistanceParseResult {
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

export function resolveDurationFromText(rawText: string): number | null {
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

  const apostropheMinutes = text.match(/\b(\d+(?:\.\d+)?)\s*['']/);
  if (apostropheMinutes) {
    const mins = Number(apostropheMinutes[1]);
    if (Number.isFinite(mins) && mins > 0 && mins <= 300) return Math.round(mins);
  }

  return null;
}
