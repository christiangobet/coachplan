import { normalizePlanText } from '@/lib/plan-parser-i18n.mjs';

export const RUN_SUBTYPES = new Set([
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

export const SUBTYPE_TITLES: Record<string, string> = {
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

export function normalizeSubtypeToken(value: string | null | undefined) {
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

export function inferSubtype(text: string) {
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

export function mapActivityType(subtype: string) {
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

export function mapAiTypeToActivityType(type: string | null | undefined) {
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

export function mapAiSessionTypeToSubtype(sessionType: string | null | undefined) {
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

export function mapAiPrimarySportToType(primarySport: string | null | undefined) {
  const normalized = String(primarySport || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'run') return 'RUN';
  if (normalized === 'strength') return 'STRENGTH';
  if (normalized === 'mobility') return 'MOBILITY';
  if (normalized === 'bike' || normalized === 'swim') return 'CROSS_TRAIN';
  return null;
}
