import { ActivityType, Units } from '@prisma/client';
import { inferPaceBucketFromText, type PaceBucket } from '@/lib/intensity-targets';

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

const ZONE_MULTIPLIERS: Record<PaceBucket, number> = {
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
  const pace = (zone: PaceBucket) => formatPace(raceSecPerKm * ZONE_MULTIPLIERS[zone], args.unit);

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
  const inferred = inferPaceBucketFromText(text);
  return inferred || ('EASY' as const);
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
