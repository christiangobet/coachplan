export type PaceBucket = 'RECOVERY' | 'EASY' | 'LONG' | 'RACE' | 'TEMPO' | 'THRESHOLD' | 'INTERVAL';

const PACE_VALUE_RE = /\b\d{1,2}[:.]\d{2}(?:\s*(?:-|–|—|to)\s*\d{1,2}[:.]\d{2})?\s*(?:min(?:ute)?s?)?\s*(?:\/|per\s*)(?:km|mi|mile|miles)\b/i;
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
