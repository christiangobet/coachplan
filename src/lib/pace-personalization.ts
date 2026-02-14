import { ActivityType, Units } from '@prisma/client';

type PaceZone = 'RECOVERY' | 'EASY' | 'LONG' | 'RACE' | 'TEMPO' | 'THRESHOLD' | 'INTERVAL';

export type DerivedPaceProfile = {
  unit: Units;
  raceDistanceKm: number;
  goalTimeSec: number;
  race: string;
  long: string;
  easy: string;
  recovery: string;
  tempo: string;
  threshold: string;
  interval: string;
};

const ZONE_MULTIPLIERS: Record<PaceZone, number> = {
  RECOVERY: 1.22,
  EASY: 1.14,
  LONG: 1.09,
  RACE: 1.0,
  TEMPO: 0.96,
  THRESHOLD: 0.93,
  INTERVAL: 0.87
};

function toPerUnit(secPerKm: number, unit: Units) {
  return unit === 'KM' ? secPerKm : secPerKm * 1.609344;
}

function formatPace(secPerKm: number, unit: Units) {
  const secPerUnit = toPerUnit(secPerKm, unit);
  const mins = Math.floor(secPerUnit / 60);
  const secs = Math.round(secPerUnit - mins * 60);
  const unitLabel = unit === 'KM' ? '/km' : '/mi';
  return `${mins}:${String(secs).padStart(2, '0')} ${unitLabel}`;
}

export function derivePaceProfileFromRaceTarget(args: {
  raceDistanceKm: number;
  goalTimeSec: number;
  unit: Units;
}): DerivedPaceProfile {
  const raceDistanceKm = Math.max(0.1, args.raceDistanceKm);
  const goalTimeSec = Math.max(60, args.goalTimeSec);
  const raceSecPerKm = goalTimeSec / raceDistanceKm;
  const pace = (zone: PaceZone) => formatPace(raceSecPerKm * ZONE_MULTIPLIERS[zone], args.unit);

  return {
    unit: args.unit,
    raceDistanceKm,
    goalTimeSec,
    race: pace('RACE'),
    long: pace('LONG'),
    easy: pace('EASY'),
    recovery: pace('RECOVERY'),
    tempo: pace('TEMPO'),
    threshold: pace('THRESHOLD'),
    interval: pace('INTERVAL')
  };
}

function normalizeText(text: string | null | undefined) {
  return String(text || '').toLowerCase();
}

export function classifyRunPaceBucket(activity: {
  type: ActivityType;
  subtype?: string | null;
  title?: string | null;
  rawText?: string | null;
}) {
  if (activity.type !== 'RUN') return null;
  const text = [activity.subtype, activity.title, activity.rawText].map(normalizeText).join(' ');

  if (/\b(rest|off)\b/.test(text)) return null;
  if (/\b(race pace|rp\b|goal pace|marathon pace|mp\b)\b/.test(text)) return 'RACE' as const;
  if (/\b(interval|repeat|repeats|fartlek|track|reps?)\b/.test(text) || /\b\d+\s*x\s*\d+/.test(text)) return 'INTERVAL' as const;
  if (/\b(threshold|t pace|t-pace|lt)\b/.test(text)) return 'THRESHOLD' as const;
  if (/\b(tempo|steady state)\b/.test(text)) return 'TEMPO' as const;
  if (/\b(long run|long|lr)\b/.test(text)) return 'LONG' as const;
  if (/\b(recovery)\b/.test(text)) return 'RECOVERY' as const;
  if (/\b(easy|aerobic)\b/.test(text)) return 'EASY' as const;
  if (/\b(progression|fast finish)\b/.test(text)) return 'TEMPO' as const;
  return 'EASY' as const;
}

export function buildPaceTargetText(
  bucket: ReturnType<typeof classifyRunPaceBucket>,
  profile: DerivedPaceProfile
) {
  if (!bucket) return null;
  if (bucket === 'INTERVAL') return `${profile.interval} reps, ${profile.recovery} recoveries`;
  if (bucket === 'THRESHOLD') return profile.threshold;
  if (bucket === 'TEMPO') return profile.tempo;
  if (bucket === 'RACE') return profile.race;
  if (bucket === 'LONG') return profile.long;
  if (bucket === 'RECOVERY') return profile.recovery;
  return profile.easy;
}
