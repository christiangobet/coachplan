import { ActivityPriority, ActivityType } from '@prisma/client';

export type EquivalenceStatus = 'FULL' | 'PARTIAL' | 'NONE';
export type PlannedIntent = 'RECOVERY' | 'EASY_AEROBIC' | 'LONG_AEROBIC' | 'QUALITY';

type PlannedEquivalenceInput = {
  type: ActivityType;
  title?: string | null;
  subtype?: string | null;
  paceTargetBucket?: string | null;
  durationSec?: number | null;
  distanceM?: number | null;
  priority?: ActivityPriority | null;
  mustDo?: boolean;
};

type ActualEquivalenceInput = {
  sportType?: string | null;
  movingTimeSec?: number | null;
  elapsedTimeSec?: number | null;
  distanceM?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  elevationGainM?: number | null;
};

export type EquivalenceResult = {
  intent: PlannedIntent;
  status: EquivalenceStatus;
  loadRatio: number | null;
  confidence: number;
  note: string;
  overload: boolean;
};

type SportFamily = 'RUN' | 'WALK_HIKE' | 'RIDE' | 'SKI' | 'ALPINE' | 'STRENGTH' | 'MOBILITY' | 'OTHER';

const SPORT_MULTIPLIER_BY_FAMILY: Record<SportFamily, number> = {
  RUN: 1.0,
  WALK_HIKE: 0.75,
  RIDE: 0.85,
  SKI: 0.95,
  ALPINE: 0.6,
  STRENGTH: 0.7,
  MOBILITY: 0.55,
  OTHER: 0.7
};

const DEFAULT_DURATION_BY_INTENT_MIN: Record<PlannedIntent, number> = {
  RECOVERY: 35,
  EASY_AEROBIC: 50,
  LONG_AEROBIC: 90,
  QUALITY: 60
};

function normalizeSportType(value: string | null | undefined) {
  if (!value) return '';
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

function sportFamilyFromStravaType(sportType: string | null | undefined): SportFamily {
  const normalized = normalizeSportType(sportType);
  if (!normalized) return 'OTHER';

  if (
    normalized.includes('TRAIL_RUN')
    || normalized.includes('RUN')
    || normalized.includes('TREADMILL')
  ) {
    return 'RUN';
  }
  if (normalized.includes('WALK') || normalized.includes('HIKE')) return 'WALK_HIKE';
  if (normalized.includes('RIDE') || normalized.includes('BIKE') || normalized.includes('CYCL')) return 'RIDE';
  if (normalized.includes('NORDIC') || normalized.includes('SKI_TOUR') || normalized.includes('BACKCOUNTRY')) return 'SKI';
  if (normalized.includes('ALPINE') || normalized.includes('SNOWBOARD') || normalized.includes('DOWNHILL')) return 'ALPINE';
  if (
    normalized.includes('WORKOUT')
    || normalized.includes('WEIGHT')
    || normalized.includes('CROSSFIT')
    || normalized.includes('TRAINING')
  ) {
    return 'STRENGTH';
  }
  if (normalized.includes('YOGA') || normalized.includes('PILATES') || normalized.includes('MOBILITY')) return 'MOBILITY';
  return 'OTHER';
}

function sportFamilyFromPlannedType(type: ActivityType): SportFamily {
  if (type === 'RUN') return 'RUN';
  if (type === 'HIKE') return 'WALK_HIKE';
  if (type === 'CROSS_TRAIN') return 'RIDE';
  if (type === 'STRENGTH') return 'STRENGTH';
  if (type === 'MOBILITY' || type === 'YOGA') return 'MOBILITY';
  return 'OTHER';
}

function formatSportLabel(sportType: string | null | undefined) {
  const normalized = normalizeSportType(sportType);
  if (!normalized) return 'External activity';
  return normalized
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

export function inferPlannedIntent(activity: PlannedEquivalenceInput): PlannedIntent {
  const title = `${activity.title || ''} ${activity.subtype || ''}`.toLowerCase();
  const paceBucket = String(activity.paceTargetBucket || '').toUpperCase();
  const isKey = activity.mustDo === true || activity.priority === 'KEY';

  if (
    /interval|tempo|threshold|hill|repeats?|track|fartlek|quality|race/.test(title)
    || ['INTERVAL', 'THRESHOLD', 'TEMPO', 'RACE'].includes(paceBucket)
    || isKey
  ) {
    return 'QUALITY';
  }
  if (/long run|long|lrl|\blr\b/.test(title) || paceBucket === 'LONG') {
    return 'LONG_AEROBIC';
  }
  if (/recovery|rest|easy/.test(title) || ['RECOVERY', 'EASY'].includes(paceBucket)) {
    return 'EASY_AEROBIC';
  }
  if (activity.type === 'REST') return 'RECOVERY';
  return 'EASY_AEROBIC';
}

function intensityFactor(avgHeartRate: number | null | undefined, maxHeartRate: number | null | undefined) {
  if (!avgHeartRate || avgHeartRate <= 0) return 1;
  if (maxHeartRate && maxHeartRate > avgHeartRate) {
    const ratio = avgHeartRate / maxHeartRate;
    if (ratio < 0.6) return 0.75;
    if (ratio < 0.75) return 1.0;
    if (ratio < 0.85) return 1.15;
    return 1.3;
  }
  if (avgHeartRate < 120) return 0.85;
  if (avgHeartRate < 145) return 1.0;
  if (avgHeartRate < 165) return 1.1;
  return 1.2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeBaseRatio(args: {
  plannedDurationMin: number | null;
  plannedDistanceM: number | null;
  actualDurationMin: number | null;
  actualDistanceM: number | null;
}) {
  const durationRatio = args.plannedDurationMin && args.actualDurationMin
    ? args.actualDurationMin / args.plannedDurationMin
    : null;
  const distanceRatio = args.plannedDistanceM && args.actualDistanceM
    ? args.actualDistanceM / args.plannedDistanceM
    : null;

  if (durationRatio && distanceRatio) {
    return round((durationRatio * 0.7) + (distanceRatio * 0.3), 3);
  }
  if (durationRatio) return round(durationRatio, 3);
  if (distanceRatio) return round(distanceRatio, 3);
  return null;
}

function classifyStatus(args: {
  intent: PlannedIntent;
  ratio: number | null;
  actualFamily: SportFamily;
  plannedFamily: SportFamily;
}): { status: EquivalenceStatus; overload: boolean } {
  if (args.ratio === null || !Number.isFinite(args.ratio) || args.ratio <= 0) {
    return { status: 'NONE', overload: false };
  }

  const overload = args.ratio > 1.4;
  const qualityIntent = args.intent === 'QUALITY';
  const runLikeActual = args.actualFamily === 'RUN';

  if (qualityIntent && !runLikeActual) {
    if (args.ratio >= 0.85) return { status: 'PARTIAL', overload };
    return { status: 'NONE', overload };
  }

  const fullThreshold = qualityIntent ? 0.9 : 0.85;
  const partialThreshold = qualityIntent ? 0.6 : 0.5;

  if (args.ratio >= fullThreshold) return { status: 'FULL', overload };
  if (args.ratio >= partialThreshold) return { status: 'PARTIAL', overload };
  return { status: 'NONE', overload };
}

function buildConfidence(args: {
  ratio: number | null;
  hadPlannedDefaults: boolean;
  hasDurationPair: boolean;
  hasDistancePair: boolean;
  hasHeartRate: boolean;
  sportCompatible: boolean;
  actualFamily: SportFamily;
}): number {
  let confidence = 0.35;
  if (args.ratio !== null) confidence += 0.15;
  if (args.hasDurationPair) confidence += 0.2;
  if (args.hasDistancePair) confidence += 0.1;
  if (args.hasHeartRate) confidence += 0.1;
  if (args.sportCompatible) confidence += 0.1;
  if (args.actualFamily === 'OTHER') confidence -= 0.08;
  if (args.hadPlannedDefaults) confidence -= 0.15;
  return round(clamp(confidence, 0.1, 0.95), 2);
}

export function evaluateStravaEquivalence(args: {
  planned: PlannedEquivalenceInput;
  actual: ActualEquivalenceInput;
}): EquivalenceResult {
  const intent = inferPlannedIntent(args.planned);
  const plannedFamily = sportFamilyFromPlannedType(args.planned.type);
  const actualFamily = sportFamilyFromStravaType(args.actual.sportType);

  const plannedDurationMinRaw = args.planned.durationSec && args.planned.durationSec > 0
    ? args.planned.durationSec / 60
    : null;
  const plannedDistanceM = args.planned.distanceM && args.planned.distanceM > 0 ? args.planned.distanceM : null;
  const actualDurationMin = args.actual.movingTimeSec && args.actual.movingTimeSec > 0
    ? args.actual.movingTimeSec / 60
    : (args.actual.elapsedTimeSec && args.actual.elapsedTimeSec > 0 ? args.actual.elapsedTimeSec / 60 : null);
  const actualDistanceM = args.actual.distanceM && args.actual.distanceM > 0 ? args.actual.distanceM : null;
  const hadPlannedDefaults = plannedDurationMinRaw === null && plannedDistanceM === null;
  const plannedDurationMin = plannedDurationMinRaw ?? (hadPlannedDefaults ? DEFAULT_DURATION_BY_INTENT_MIN[intent] : null);

  const baseRatio = computeBaseRatio({
    plannedDurationMin,
    plannedDistanceM,
    actualDurationMin,
    actualDistanceM
  });

  const hrFactor = intensityFactor(args.actual.avgHeartRate, args.actual.maxHeartRate);
  const elevationBoost = args.actual.elevationGainM && args.actual.elevationGainM >= 400
    ? 1.08
    : args.actual.elevationGainM && args.actual.elevationGainM >= 200
      ? 1.04
      : 1;
  const sportFactor = SPORT_MULTIPLIER_BY_FAMILY[actualFamily];
  const ratio = baseRatio === null ? null : round(baseRatio * hrFactor * sportFactor * elevationBoost, 3);

  const sameFamily = plannedFamily === actualFamily;
  const sportCompatible = sameFamily || (
    plannedFamily === 'RUN' && (actualFamily === 'WALK_HIKE' || actualFamily === 'RIDE' || actualFamily === 'SKI')
  ) || (
    plannedFamily === 'RIDE' && (actualFamily === 'RUN' || actualFamily === 'SKI')
  );

  const { status, overload } = classifyStatus({
    intent,
    ratio,
    actualFamily,
    plannedFamily
  });

  const confidence = buildConfidence({
    ratio,
    hadPlannedDefaults,
    hasDurationPair: Boolean(plannedDurationMin && actualDurationMin),
    hasDistancePair: Boolean(plannedDistanceM && actualDistanceM),
    hasHeartRate: Boolean(args.actual.avgHeartRate && args.actual.avgHeartRate > 0),
    sportCompatible,
    actualFamily
  });

  const sportLabel = formatSportLabel(args.actual.sportType);
  const ratioText = ratio !== null ? `${Math.round(ratio * 100)}%` : 'unknown load';
  const plannedText = plannedDurationMin ? `${Math.round(plannedDurationMin)} min planned` : 'planned load unavailable';
  const actualText = actualDurationMin ? `${Math.round(actualDurationMin)} min actual` : 'actual duration unavailable';

  let note = `${sportLabel}: ${ratioText} load (${actualText} vs ${plannedText}).`;
  if (status === 'PARTIAL') note = `${sportLabel} partially matches this session (${ratioText} load).`;
  if (status === 'NONE') note = `${sportLabel} does not replace this planned session (${ratioText}).`;
  if (intent === 'QUALITY' && actualFamily !== 'RUN') {
    note = `${sportLabel} cannot fully replace a quality run; marked ${status.toLowerCase()}.`;
  } else if (overload) {
    note = `${sportLabel} exceeded planned load (${ratioText}); treat as overload.`;
  }

  return {
    intent,
    status,
    loadRatio: ratio,
    confidence,
    note,
    overload
  };
}
