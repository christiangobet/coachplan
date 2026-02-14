export type DistanceUnit = 'MILES' | 'KM';

const KM_PER_MILE = 1.609344;

function roundTwo(value: number) {
  return Number(value.toFixed(2));
}

function getDecimalHundredths(value: number) {
  const abs = Math.abs(value);
  const whole = Math.trunc(abs);
  return Math.round((abs - whole) * 100);
}

function snapConvertedValue(value: number) {
  const rounded = roundTwo(value);
  const sign = rounded < 0 ? -1 : 1;
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs);
  const hundredths = getDecimalHundredths(abs);

  if (hundredths === 99) {
    return sign * (whole + 1);
  }
  if (hundredths === 49) {
    return sign * (whole + 0.5);
  }
  return rounded;
}

export function normalizeDistanceUnit(unit: string | null | undefined): DistanceUnit | null {
  if (!unit) return null;
  const normalized = unit.trim().toUpperCase();
  if (normalized === 'KM') return 'KM';
  if (normalized === 'MILES') return 'MILES';
  if (normalized === 'MI' || normalized === 'MILE' || normalized === 'MILES') return 'MILES';
  return null;
}

export function distanceUnitLabel(unit: DistanceUnit) {
  return unit === 'KM' ? 'km' : 'mi';
}

export function formatDistanceNumber(value: number) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

export function convertDistanceValue(value: number, from: DistanceUnit, to: DistanceUnit) {
  if (from === to) return value;
  if (from === 'MILES' && to === 'KM') return value * KM_PER_MILE;
  return value / KM_PER_MILE;
}

function convertPaceSeconds(value: number, from: DistanceUnit, to: DistanceUnit) {
  if (from === to) return value;
  if (from === 'MILES' && to === 'KM') return value / KM_PER_MILE;
  return value * KM_PER_MILE;
}

export function convertDistanceForDisplay(
  value: number | null | undefined,
  sourceUnit: string | null | undefined,
  viewerUnit: DistanceUnit
) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  const source = normalizeDistanceUnit(sourceUnit) || viewerUnit;
  if (source === viewerUnit) {
    const stable = roundTwo(value);
    return { value: stable, unit: viewerUnit };
  }
  const converted = convertDistanceValue(value, source, viewerUnit);
  return { value: snapConvertedValue(converted), unit: viewerUnit };
}

function parsePaceUnitToken(token: string): DistanceUnit | null {
  const normalized = token.trim().toLowerCase();
  if (normalized === 'km' || normalized === 'k') return 'KM';
  if (normalized === 'mi' || normalized === 'mile' || normalized === 'miles') return 'MILES';
  return null;
}

function formatPaceFromSeconds(secPerUnit: number, unit: DistanceUnit) {
  const safe = Math.max(0, Math.round(secPerUnit));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} /${distanceUnitLabel(unit)}`;
}

export function convertPaceForDisplay(
  rawPace: string | null | undefined,
  targetUnit: DistanceUnit,
  sourceUnitHint?: string | null
) {
  if (!rawPace || typeof rawPace !== 'string') return rawPace || null;
  const text = rawPace.trim();
  if (!text) return null;

  const fullWithoutUnit = text.match(/^(\d{1,2})\s*:\s*(\d{2})$/);
  if (fullWithoutUnit) {
    const source = normalizeDistanceUnit(sourceUnitHint);
    if (!source) return text;
    const minutes = Number(fullWithoutUnit[1]);
    const seconds = Number(fullWithoutUnit[2]);
    if (seconds > 59) return text;
    const secPerSource = minutes * 60 + seconds;
    const secPerTarget = convertPaceSeconds(secPerSource, source, targetUnit);
    return formatPaceFromSeconds(secPerTarget, targetUnit);
  }

  const withUnit = /(\d{1,2})\s*:\s*(\d{2})\s*(?:min\s*)?(?:\/|per)\s*(mi|mile|miles|km|k)\b/i.exec(text);
  if (!withUnit || withUnit.index === undefined) return text;

  const minutes = Number(withUnit[1]);
  const seconds = Number(withUnit[2]);
  if (seconds > 59) return text;

  const parsedFromText = parsePaceUnitToken(withUnit[3]);
  const source = parsedFromText || normalizeDistanceUnit(sourceUnitHint);
  if (!source) return text;

  const secPerSource = minutes * 60 + seconds;
  const secPerTarget = convertPaceSeconds(secPerSource, source, targetUnit);
  const replacement = formatPaceFromSeconds(secPerTarget, targetUnit);

  const start = withUnit.index;
  const end = start + withUnit[0].length;
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`.trim();
}
