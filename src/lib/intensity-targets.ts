export type PaceBucket = 'RECOVERY' | 'EASY' | 'LONG' | 'RACE' | 'TEMPO' | 'THRESHOLD' | 'INTERVAL';
export type PaceTargetMode = 'SYMBOLIC' | 'NUMERIC' | 'RANGE' | 'HYBRID' | 'UNKNOWN';
export type EffortTargetType = 'RPE' | 'HR_ZONE' | 'HR_BPM' | 'TEXT';

export type StructuredPaceTarget = {
  mode: PaceTargetMode;
  bucket: PaceBucket | null;
  minSec: number | null;
  maxSec: number | null;
  unit: 'KM' | 'MILES' | null;
};

export type StructuredEffortTarget = {
  type: EffortTargetType;
  min: number | null;
  max: number | null;
  zone: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
};

export type StructuredIntensityTargets = {
  paceTargetMode: PaceTargetMode | null;
  paceTargetBucket: PaceBucket | null;
  paceTargetMinSec: number | null;
  paceTargetMaxSec: number | null;
  paceTargetUnit: 'KM' | 'MILES' | null;
  effortTargetType: EffortTargetType | null;
  effortTargetMin: number | null;
  effortTargetMax: number | null;
  effortTargetZone: number | null;
  effortTargetBpmMin: number | null;
  effortTargetBpmMax: number | null;
};

const PACE_VALUE_RE = /\b\d{1,2}[:.]\d{2}(?:\s*(?:-|–|—|to)\s*\d{1,2}[:.]\d{2})?\s*(?:min(?:ute)?s?)?\s*(?:\/|per\s*)(?:km|mi|mile|miles)\b/i;
const PACE_VALUE_CAPTURE_RE = /(\d{1,2})[:.](\d{2})(?:\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2}))?\s*(?:min(?:ute)?s?)?\s*(?:(?:\/|per\s*)(km|mi|mile|miles|k))?/ig;
const PACE_BUCKET_PATTERNS: Array<{ bucket: PaceBucket; regex: RegExp }> = [
  { bucket: 'RACE', regex: /\b(?:race pace|goal pace|marathon pace|mp\b|rp\b|half marathon pace|hm pace|10k pace|5k pace)\b/i },
  { bucket: 'THRESHOLD', regex: /\b(?:threshold|t[-\s]?pace|lt pace|lactate threshold)\b/i },
  { bucket: 'TEMPO', regex: /\b(?:tempo|steady state|progression|fast finish)\b/i },
  { bucket: 'INTERVAL', regex: /\b(?:interval|repeats?|reps?|track|fartlek|vo2|max|hills?)\b|\b\d+\s*x\s*\d+\b/i },
  { bucket: 'LONG', regex: /\b(?:long run|lrl\b|lr\b)\b/i },
  { bucket: 'RECOVERY', regex: /\b(?:recovery)\b/i },
  { bucket: 'EASY', regex: /\b(?:easy|aerobic)\b/i }
];

const PACE_BUCKET_LABELS: Record<PaceBucket, string> = {
  RECOVERY: 'Recovery pace',
  EASY: 'Easy pace',
  LONG: 'Long run pace',
  RACE: 'Race pace',
  TEMPO: 'Tempo pace',
  THRESHOLD: 'Threshold pace',
  INTERVAL: 'Interval pace'
};

function cleanText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePaceExpression(value: string) {
  return cleanText(value).replace(/\s*per\s*/gi, '/').replace(/\s*\/\s*/g, ' /');
}

function paceTokenToUnit(token: string | null | undefined): 'KM' | 'MILES' | null {
  const normalized = cleanText(token).toLowerCase();
  if (!normalized) return null;
  if (normalized === 'km' || normalized === 'k') return 'KM';
  if (normalized === 'mi' || normalized === 'mile' || normalized === 'miles') return 'MILES';
  return null;
}

function parsePacePartToSec(minutesPart: string, secondsPart: string): number | null {
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes < 0 || seconds < 0 || seconds > 59) return null;
  return minutes * 60 + seconds;
}

export function hasConcretePaceValue(value: string | null | undefined) {
  const text = cleanText(value);
  return text ? PACE_VALUE_RE.test(text) : false;
}

export function inferPaceBucketFromText(value: string | null | undefined): PaceBucket | null {
  const text = cleanText(value);
  if (!text) return null;
  for (const candidate of PACE_BUCKET_PATTERNS) {
    if (candidate.regex.test(text)) return candidate.bucket;
  }
  return null;
}

export function inferSymbolicPaceBucketFromText(value: string | null | undefined): PaceBucket | null {
  const text = cleanText(value);
  if (!text || hasConcretePaceValue(text)) return null;
  return inferPaceBucketFromText(text);
}

export function paceBucketLabel(bucket: PaceBucket) {
  return PACE_BUCKET_LABELS[bucket];
}

export function extractPaceTargetFromText(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;

  const concrete = text.match(PACE_VALUE_RE);
  if (concrete?.[0]) return normalizePaceExpression(concrete[0]);

  const bucket = inferPaceBucketFromText(text);
  return bucket ? paceBucketLabel(bucket) : null;
}

export function extractEffortTargetFromText(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;

  const rpe = text.match(/\brpe\s*[:@]?\s*(\d(?:\.\d)?(?:\s*[-–]\s*\d(?:\.\d)?)?(?:\s*\/\s*10)?)\b/i);
  if (rpe?.[1]) {
    const normalized = cleanText(rpe[1]);
    return normalized.includes('/10') ? `RPE ${normalized}` : `RPE ${normalized}/10`;
  }

  const bareRpe = text.match(/\b(\d(?:\.\d)?)\s*\/\s*10\b/);
  if (bareRpe?.[1]) return `RPE ${bareRpe[1]}/10`;

  const zone = text.match(/\b(?:hr|heart rate)?\s*(?:zone\s*([1-5])|z([1-5]))\b/i);
  if (zone?.[1] || zone?.[2]) {
    const zoneNum = zone[1] || zone[2];
    return `HR Zone Z${zoneNum}`;
  }

  const bpmRange = text.match(/\b(\d{2,3}\s*(?:-|–|—|to)\s*\d{2,3}\s*bpm)\b/i);
  if (bpmRange?.[1]) return `HR ${cleanText(bpmRange[1]).replace(/\s*to\s*/gi, '-')}`;

  const bpmSingle = text.match(/\b(\d{2,3}\s*bpm)\b/i);
  if (bpmSingle?.[1]) return `HR ${cleanText(bpmSingle[1])}`;

  const effortWord = text.match(/\b(easy|moderate|hard)\s+effort\b/i);
  if (effortWord?.[1]) return `${effortWord[1][0].toUpperCase()}${effortWord[1].slice(1).toLowerCase()} effort`;

  return null;
}

export function parseStructuredPaceTarget(
  value: string | null | undefined,
  fallbackUnit?: string | null
): StructuredPaceTarget | null {
  const text = cleanText(value);
  if (!text) return null;

  const bucket = inferPaceBucketFromText(text);
  const paceMatches: Array<{ minSec: number; maxSec: number; unit: 'KM' | 'MILES' | null }> = [];
  let match: RegExpExecArray | null = null;

  PACE_VALUE_CAPTURE_RE.lastIndex = 0;
  while ((match = PACE_VALUE_CAPTURE_RE.exec(text)) !== null) {
    const first = parsePacePartToSec(match[1], match[2]);
    if (first === null) continue;
    const second = match[3] && match[4] ? parsePacePartToSec(match[3], match[4]) : null;
    paceMatches.push({
      minSec: first,
      maxSec: second ?? first,
      unit: paceTokenToUnit(match[5])
    });
  }

  const fallbackPaceUnit = paceTokenToUnit(fallbackUnit);
  if (paceMatches.length === 0) {
    return {
      mode: bucket ? 'SYMBOLIC' : 'UNKNOWN',
      bucket: bucket || null,
      minSec: null,
      maxSec: null,
      unit: fallbackPaceUnit
    };
  }

  const units = paceMatches.map((entry) => entry.unit).filter((entry): entry is 'KM' | 'MILES' => Boolean(entry));
  const resolvedUnit = units[0] || fallbackPaceUnit || null;
  const minSec = Math.min(...paceMatches.map((entry) => entry.minSec));
  const maxSec = Math.max(...paceMatches.map((entry) => entry.maxSec));
  const hasRange = paceMatches.some((entry) => entry.maxSec !== entry.minSec);
  const mode: PaceTargetMode = paceMatches.length > 1 ? 'HYBRID' : hasRange ? 'RANGE' : 'NUMERIC';

  return {
    mode,
    bucket: bucket || null,
    minSec: Number.isFinite(minSec) ? minSec : null,
    maxSec: Number.isFinite(maxSec) ? maxSec : null,
    unit: resolvedUnit
  };
}

export function parseStructuredEffortTarget(value: string | null | undefined): StructuredEffortTarget | null {
  const text = cleanText(value);
  if (!text) return null;

  const rpe = text.match(/\brpe\s*[:@]?\s*(\d(?:\.\d)?)(?:\s*[-–]\s*(\d(?:\.\d)?))?(?:\s*\/\s*10)?\b/i);
  if (rpe?.[1]) {
    const min = Number(rpe[1]);
    const max = rpe[2] ? Number(rpe[2]) : min;
    return {
      type: 'RPE',
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      zone: null,
      bpmMin: null,
      bpmMax: null
    };
  }

  const bareRpe = text.match(/\b(\d(?:\.\d)?)\s*\/\s*10\b/);
  if (bareRpe?.[1]) {
    const valueNum = Number(bareRpe[1]);
    return {
      type: 'RPE',
      min: Number.isFinite(valueNum) ? valueNum : null,
      max: Number.isFinite(valueNum) ? valueNum : null,
      zone: null,
      bpmMin: null,
      bpmMax: null
    };
  }

  const zone = text.match(/\b(?:hr|heart rate)?\s*(?:zone\s*([1-5])|z([1-5]))\b/i);
  if (zone?.[1] || zone?.[2]) {
    const zoneValue = Number(zone[1] || zone[2]);
    return {
      type: 'HR_ZONE',
      min: null,
      max: null,
      zone: Number.isFinite(zoneValue) ? zoneValue : null,
      bpmMin: null,
      bpmMax: null
    };
  }

  const bpmRange = text.match(/\b(\d{2,3})\s*(?:-|–|—|to)\s*(\d{2,3})\s*bpm\b/i);
  if (bpmRange?.[1] && bpmRange?.[2]) {
    const min = Number(bpmRange[1]);
    const max = Number(bpmRange[2]);
    return {
      type: 'HR_BPM',
      min: null,
      max: null,
      zone: null,
      bpmMin: Number.isFinite(min) ? min : null,
      bpmMax: Number.isFinite(max) ? max : null
    };
  }

  const bpmSingle = text.match(/\b(\d{2,3})\s*bpm\b/i);
  if (bpmSingle?.[1]) {
    const bpm = Number(bpmSingle[1]);
    return {
      type: 'HR_BPM',
      min: null,
      max: null,
      zone: null,
      bpmMin: Number.isFinite(bpm) ? bpm : null,
      bpmMax: Number.isFinite(bpm) ? bpm : null
    };
  }

  return {
    type: 'TEXT',
    min: null,
    max: null,
    zone: null,
    bpmMin: null,
    bpmMax: null
  };
}

export function deriveStructuredIntensityTargets(args: {
  paceTarget?: string | null;
  effortTarget?: string | null;
  fallbackUnit?: string | null;
}): StructuredIntensityTargets {
  const pace = parseStructuredPaceTarget(args.paceTarget, args.fallbackUnit);
  const effort = parseStructuredEffortTarget(args.effortTarget);
  return {
    paceTargetMode: pace?.mode ?? null,
    paceTargetBucket: pace?.bucket ?? null,
    paceTargetMinSec: pace?.minSec ?? null,
    paceTargetMaxSec: pace?.maxSec ?? null,
    paceTargetUnit: pace?.unit ?? null,
    effortTargetType: effort?.type ?? null,
    effortTargetMin: effort?.min ?? null,
    effortTargetMax: effort?.max ?? null,
    effortTargetZone: effort?.zone ?? null,
    effortTargetBpmMin: effort?.bpmMin ?? null,
    effortTargetBpmMax: effort?.bpmMax ?? null
  };
}
