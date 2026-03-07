type NormalizedActivityType =
  | 'RUN'
  | 'STRENGTH'
  | 'CROSS_TRAIN'
  | 'REST'
  | 'MOBILITY'
  | 'YOGA'
  | 'HIKE'
  | 'OTHER';

const GENERIC_TITLES_BY_TYPE: Record<NormalizedActivityType, string[]> = {
  RUN: ['run', 'running', 'workout', 'session', 'training'],
  STRENGTH: ['strength', 'strength training', 'gym', 'workout', 'session', 'training'],
  CROSS_TRAIN: ['cross train', 'cross training', 'xt', 'workout', 'session', 'training'],
  REST: ['rest', 'rest day', 'off', 'off day'],
  MOBILITY: ['mobility', 'mobility work', 'workout', 'session', 'training'],
  YOGA: ['yoga', 'workout', 'session', 'training'],
  HIKE: ['hike', 'hiking', 'workout', 'session', 'training'],
  OTHER: ['workout', 'session', 'training'],
};

const SUBTYPE_TITLE_MAP: Record<string, string> = {
  interval: 'Intervals',
  tempo: 'Tempo Run',
  threshold: 'Threshold Run',
  recovery: 'Recovery Run',
  'easy-run': 'Easy Run',
  easy: 'Easy Run',
  distance: 'Run',
  lrl: 'Long Run',
  'long-run': 'Long Run',
  'long_run': 'Long Run',
  hills: 'Hill Workout',
  'hill-pyramid': 'Hill Pyramid',
  'training-race': 'Training Race',
  race: 'Race',
  'time-trial': 'Time Trial',
  time_trial: 'Time Trial',
  'cross-train': 'Cross Train',
  cross_train: 'Cross Train',
  strength: 'Strength',
  mobility: 'Mobility',
  yoga: 'Yoga',
  hike: 'Hike',
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  note: 'Run',
};

const STEP_PRIORITY: Record<string, number> = {
  interval: 0,
  tempo: 1,
  threshold: 2,
  distance: 3,
  easy: 4,
  recovery: 5,
  warmup: 6,
  cooldown: 7,
  note: 8,
};

type SmartTitleInput = {
  currentTitle?: string | null;
  activityType?: string | null;
  subtype?: string | null;
  sessionType?: string | null;
  structure?: unknown;
  sessionInstructions?: string | null;
  rawText?: string | null;
  fallbackTitle?: string | null;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

function toTitleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function normalizeActivityType(value: string | null | undefined): NormalizedActivityType {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_');
  if (normalized === 'RUN') return 'RUN';
  if (normalized === 'STRENGTH') return 'STRENGTH';
  if (normalized === 'CROSS_TRAIN' || normalized === 'CROSSTRAIN') return 'CROSS_TRAIN';
  if (normalized === 'REST') return 'REST';
  if (normalized === 'MOBILITY') return 'MOBILITY';
  if (normalized === 'YOGA') return 'YOGA';
  if (normalized === 'HIKE') return 'HIKE';
  return 'OTHER';
}

function fallbackTypeTitle(activityType: NormalizedActivityType): string {
  if (activityType === 'CROSS_TRAIN') return 'Cross Train';
  if (activityType === 'REST') return 'Rest Day';
  return toTitleCase(activityType.toLowerCase().replace(/_/g, ' '));
}

function formatStepNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function compactTextSnippet(input: string | null | undefined, maxLength = 40): string | null {
  const source = normalizeWhitespace(input);
  if (!source) return null;
  const sentence = source.split(/[.;!?]/)[0]?.trim() || source;
  const chunk = sentence.split(/\s*[-–—:]\s*/)[0]?.trim() || sentence;
  if (!chunk) return null;
  if (chunk.length <= maxLength) return chunk;
  const clipped = chunk.slice(0, maxLength);
  const safe = clipped.slice(0, clipped.lastIndexOf(' ')).trim();
  return `${(safe || clipped).trim()}...`;
}

function metricFromArrayStep(step: Record<string, unknown>): string | null {
  const miles = typeof step.distance_miles === 'number' && Number.isFinite(step.distance_miles)
    ? `${formatStepNumber(step.distance_miles)} mi`
    : null;
  if (miles) return miles;

  const km = typeof step.distance_km === 'number' && Number.isFinite(step.distance_km)
    ? `${formatStepNumber(step.distance_km)} km`
    : null;
  if (km) return km;

  const minutes = typeof step.duration_minutes === 'number' && Number.isFinite(step.duration_minutes)
    ? `${formatStepNumber(step.duration_minutes)} min`
    : null;
  return minutes;
}

function structureTitleFromArray(structure: unknown): string | null {
  if (!Array.isArray(structure) || structure.length === 0) return null;
  const topSteps = structure.filter(
    (step) => step && typeof step === 'object' && typeof (step as Record<string, unknown>).type === 'string'
  ) as Record<string, unknown>[];
  if (topSteps.length === 0) return null;

  const flattened = topSteps.flatMap((step) => {
    const stepType = String(step.type || '').toLowerCase();
    if (stepType !== 'repeat') return [step];
    const children = Array.isArray(step.steps)
      ? step.steps.filter(
        (child) => child && typeof child === 'object' && typeof (child as Record<string, unknown>).type === 'string'
      ) as Record<string, unknown>[]
      : [];
    return children.length > 0 ? children : [step];
  });

  const primary = flattened.sort((a, b) => {
    const aPriority = STEP_PRIORITY[String(a.type || '').toLowerCase()] ?? 99;
    const bPriority = STEP_PRIORITY[String(b.type || '').toLowerCase()] ?? 99;
    return aPriority - bPriority;
  })[0];

  if (!primary) return null;
  const typeKey = normalizeToken(String(primary.type || ''));
  const label = SUBTYPE_TITLE_MAP[typeKey] || 'Run';
  const metric = metricFromArrayStep(primary);
  return metric ? `${label} ${metric}` : label;
}

function formatRangeMetric(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const unitRaw = String(source.unit || '').toLowerCase();
  const unit = unitRaw === 'km' ? 'km' : unitRaw === 'm' ? 'm' : 'mi';
  const distance = source.distance as { min?: number; max?: number } | undefined;
  if (!distance || typeof distance !== 'object') return null;
  const maxValue = typeof distance.max === 'number' && Number.isFinite(distance.max) ? distance.max : null;
  if (maxValue === null) return null;
  return `${formatStepNumber(maxValue)} ${unit}`;
}

function structureTitleFromObject(structure: unknown): string | null {
  if (!structure || typeof structure !== 'object' || Array.isArray(structure)) return null;
  const source = structure as Record<string, unknown>;
  if (Array.isArray(source.intervals) && source.intervals.length > 0) {
    return 'Intervals';
  }
  if (source.tempo) {
    const metric = formatRangeMetric(source.tempo);
    return metric ? `Tempo Run ${metric}` : 'Tempo Run';
  }
  if (source.warmup || source.cooldown) {
    return 'Run';
  }
  return null;
}

function subtypeOrSessionTitle(
  subtype: string | null | undefined,
  sessionType: string | null | undefined,
): string | null {
  const subtypeKey = normalizeToken(String(subtype || ''));
  if (subtypeKey && subtypeKey !== 'unknown') {
    return SUBTYPE_TITLE_MAP[subtypeKey] || toTitleCase(subtypeKey);
  }
  const sessionKey = normalizeToken(String(sessionType || ''));
  if (sessionKey) {
    return SUBTYPE_TITLE_MAP[sessionKey] || toTitleCase(sessionKey);
  }
  return null;
}

export function isGenericActivityTitle(
  title: string | null | undefined,
  activityTypeInput?: string | null,
): boolean {
  const normalized = normalizeToken(title || '');
  if (!normalized) return true;
  const activityType = normalizeActivityType(activityTypeInput);
  const generic = new Set([
    ...(GENERIC_TITLES_BY_TYPE[activityType] || []),
    activityType.toLowerCase().replace(/_/g, ' '),
    'activity',
  ]);
  return generic.has(normalized);
}

export function deriveSmartActivityTitle(input: SmartTitleInput): string {
  const activityType = normalizeActivityType(input.activityType);
  const currentTitle = normalizeWhitespace(input.currentTitle);
  if (currentTitle && !isGenericActivityTitle(currentTitle, activityType)) {
    return currentTitle;
  }

  const fromStructure = Array.isArray(input.structure)
    ? structureTitleFromArray(input.structure)
    : structureTitleFromObject(input.structure);
  if (fromStructure && !isGenericActivityTitle(fromStructure, activityType)) {
    return fromStructure;
  }

  const fromSubtype = subtypeOrSessionTitle(input.subtype, input.sessionType);
  if (fromSubtype && !isGenericActivityTitle(fromSubtype, activityType)) {
    return fromSubtype;
  }

  const fromInstructions = compactTextSnippet(input.sessionInstructions);
  if (fromInstructions && !isGenericActivityTitle(fromInstructions, activityType)) {
    return fromInstructions;
  }

  const fromRawText = compactTextSnippet(input.rawText);
  if (fromRawText && !isGenericActivityTitle(fromRawText, activityType)) {
    return fromRawText;
  }

  const fallbackTitle = normalizeWhitespace(input.fallbackTitle);
  if (fallbackTitle && !isGenericActivityTitle(fallbackTitle, activityType)) {
    return fallbackTitle;
  }

  if (currentTitle) return currentTitle;
  return fallbackTypeTitle(activityType);
}
