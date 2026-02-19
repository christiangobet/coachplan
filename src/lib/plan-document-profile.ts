const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

type DayKey = (typeof DAY_KEYS)[number];

type WeekLike = {
  week_number?: number | null;
  days?: Partial<Record<DayKey, { raw?: string | null } | null>> | null;
};

type DistanceType = '5K' | '10K' | 'HALF' | 'MARATHON' | 'BASE' | 'CUSTOM' | 'UNKNOWN';
type IntensityModel = 'pace' | 'hr' | 'rpe' | 'hybrid' | 'unknown';
type Units = 'km' | 'miles' | 'unknown';
type LanguageHint = 'en' | 'de' | 'fr' | 'mixed' | 'unknown';

export type ProgramDocumentProfile = {
  plan_length_weeks: number;
  days_per_week: number;
  distance_type: DistanceType;
  intensity_model: IntensityModel;
  units: Units;
  language_hint: LanguageHint;
  includes_quality: {
    intervals: boolean;
    tempo: boolean;
    hills: boolean;
    strides: boolean;
    strength: boolean;
    cross_training: boolean;
  };
  peak_week_km: number | null;
  peak_long_run_km: number | null;
  taper_weeks: number | null;
  structure_tags: string[];
};

type DistanceSample = {
  value: number;
  unit: 'km' | 'miles';
};

function stripDiacritics(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(text: string) {
  return stripDiacritics(String(text || '')).toLowerCase();
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toKm(value: number, unit: 'km' | 'miles') {
  return unit === 'miles' ? value * 1.609344 : value;
}

function resolveDistanceUnit(rawUnit: string, value: number, fullText: string): 'km' | 'miles' | null {
  const unit = rawUnit.trim().toLowerCase();
  if (unit === 'k' || unit.startsWith('km') || unit.startsWith('kilo')) return 'km';
  if (unit === 'mi' || unit.startsWith('mile')) return 'miles';
  if (unit === 'm' || unit.startsWith('meter') || unit.startsWith('metre')) {
    // Keep short "m" values as meters only when interval context is obvious.
    const intervalContext = /\b(?:x|reps?|strides?|interval)\b/.test(fullText);
    if (value >= 100 || intervalContext) return 'km';
  }
  return null;
}

function extractDistanceSamples(rawText: string): DistanceSample[] {
  const text = normalizeText(rawText);
  if (!text) return [];

  const samples: DistanceSample[] = [];
  const pushSample = (value: number, unit: 'km' | 'miles') => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (unit === 'km' && value > 200) return;
    if (unit === 'miles' && value > 140) return;
    samples.push({ value, unit });
  };

  // Repeats, e.g. "6 x 800m" or "5x1 mile"
  for (const match of text.matchAll(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(miles?|mile|mi|km|kms|k|kilometers?|kilometres?|meters?|metres?|m)\b/g)) {
    const reps = Number(match[1]);
    const each = Number(match[2]);
    if (!Number.isFinite(reps) || reps <= 0 || !Number.isFinite(each) || each <= 0) continue;
    const resolved = resolveDistanceUnit(match[3], each, text);
    if (!resolved) continue;
    if (match[3].toLowerCase().startsWith('m') && resolved === 'km') {
      // Meters -> km for repeated interval sets.
      pushSample((reps * each) / 1000, 'km');
      continue;
    }
    pushSample(reps * each, resolved);
  }

  // Ranges and single values.
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(miles?|mile|mi|km|kms|k|kilometers?|kilometres?|meters?|metres?|m)\b/g)) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const value = Math.max(start, end);
    const resolved = resolveDistanceUnit(match[3], value, text);
    if (!resolved) continue;
    if (match[3].toLowerCase().startsWith('m') && resolved === 'km') {
      pushSample(value / 1000, 'km');
      continue;
    }
    pushSample(value, resolved);
  }

  return samples;
}

function inferUnits(weeks: WeekLike[]): Units {
  let kmHits = 0;
  let mileHits = 0;
  for (const week of weeks) {
    for (const day of DAY_KEYS) {
      const raw = String(week.days?.[day]?.raw || '');
      if (!raw) continue;
      const text = normalizeText(raw);
      kmHits += (text.match(/\b\d+(?:\.\d+)?\s*(?:km|kms|k|kilometers?|kilometres?)\b/g) || []).length;
      mileHits += (text.match(/\b\d+(?:\.\d+)?\s*(?:miles?|mile|mi)\b/g) || []).length;
    }
  }
  if (kmHits === 0 && mileHits === 0) return 'unknown';
  return kmHits >= mileHits ? 'km' : 'miles';
}

function inferLanguage(weeks: WeekLike[]): LanguageHint {
  let en = 0;
  let de = 0;
  let fr = 0;
  for (const week of weeks) {
    for (const day of DAY_KEYS) {
      const text = normalizeText(String(week.days?.[day]?.raw || ''));
      if (!text) continue;
      if (/\b(?:rest day|strength|cross training|tempo|easy run|long run|race)\b/.test(text)) en += 1;
      if (/\b(?:ruhetag|kraft|krafttraining|woche|berglauf|erholungslauf)\b/.test(text)) de += 1;
      if (/\b(?:repos|musculation|entrainement|semaine|footing|seuil|randonnee)\b/.test(text)) fr += 1;
    }
  }
  const top = Math.max(en, de, fr);
  if (top === 0) return 'unknown';
  const hits = [en, de, fr].filter((v) => v > 0).length;
  if (hits > 1) return 'mixed';
  if (top === en) return 'en';
  if (top === de) return 'de';
  return 'fr';
}

function inferIntensityModel(weeks: WeekLike[]): IntensityModel {
  let paceHits = 0;
  let hrHits = 0;
  let rpeHits = 0;

  for (const week of weeks) {
    for (const day of DAY_KEYS) {
      const text = normalizeText(String(week.days?.[day]?.raw || ''));
      if (!text) continue;
      if (
        /\b(?:pace|marathon pace|race pace|threshold|min\/km|min\/mi)\b/.test(text)
        || /\b\d{1,2}:\d{2}\s*(?:\/km|\/mi)\b/.test(text)
      ) paceHits += 1;
      if (/\b(?:hr|heart rate|bpm|lthr|z[1-5])\b/.test(text)) hrHits += 1;
      if (/\b(?:rpe|effort)\b/.test(text) || /\b(?:[1-9]|10)\/10\b/.test(text)) rpeHits += 1;
    }
  }

  const activeModels = [paceHits > 0, hrHits > 0, rpeHits > 0].filter(Boolean).length;
  if (activeModels === 0) return 'unknown';
  if (activeModels > 1) return 'hybrid';
  if (paceHits > 0) return 'pace';
  if (hrHits > 0) return 'hr';
  return 'rpe';
}

function inferDistanceType(planName: string, peakLongRunKm: number | null): DistanceType {
  const name = normalizeText(planName);
  if (/\bmarathon\b/.test(name)) return 'MARATHON';
  if (/\b(?:half|half marathon|hm)\b/.test(name)) return 'HALF';
  if (/\b10\s*k\b|\b10k\b/.test(name)) return '10K';
  if (/\b5\s*k\b|\b5k\b/.test(name)) return '5K';
  if (/\bbase\b/.test(name)) return 'BASE';

  if (peakLongRunKm === null) return 'UNKNOWN';
  if (peakLongRunKm >= 28) return 'MARATHON';
  if (peakLongRunKm >= 16) return 'HALF';
  if (peakLongRunKm >= 8) return '10K';
  if (peakLongRunKm >= 5) return '5K';
  return 'BASE';
}

export function buildProgramDocumentProfile(args: {
  planName: string;
  weeks: WeekLike[];
}): ProgramDocumentProfile {
  const { planName } = args;
  const weeks = (args.weeks || []).filter(Boolean);
  const totalWeeks = weeks.length;

  const weeklyTotalsKm: number[] = [];
  const qualityDaysPerWeek: number[] = [];
  const longRunCandidatesKm: number[] = [];
  let intervals = false;
  let tempo = false;
  let hills = false;
  let strides = false;
  let strength = false;
  let crossTraining = false;

  let daysPerWeekAccumulator = 0;
  let weeksWithData = 0;

  for (const week of weeks) {
    let populatedDays = 0;
    let weekTotalKm = 0;
    let weekQualityDays = 0;

    for (const day of DAY_KEYS) {
      const raw = String(week.days?.[day]?.raw || '').trim();
      if (!raw) continue;
      populatedDays += 1;
      const text = normalizeText(raw);

      const samples = extractDistanceSamples(raw).map((entry) => toKm(entry.value, entry.unit));
      const dayDistanceKm = samples.length ? Math.max(...samples) : 0;
      weekTotalKm += dayDistanceKm;

      const dayHasQuality =
        /\b(?:interval|repeats?|track|time trial)\b/.test(text)
        || /\b(?:tempo|threshold|t pace)\b/.test(text)
        || /\b(?:hill|hills|incline)\b/.test(text)
        || /\b(?:race|training race)\b/.test(text);
      if (dayHasQuality) weekQualityDays += 1;

      if (/\b(?:interval|repeats?|track|time trial)\b/.test(text)) intervals = true;
      if (/\b(?:tempo|threshold|t pace)\b/.test(text)) tempo = true;
      if (/\b(?:hill|hills|incline|hill pyramid)\b/.test(text)) hills = true;
      if (/\b(?:stride|strides)\b/.test(text)) strides = true;
      if (/\b(?:strength|musculation|kraft)\b/.test(text)) strength = true;
      if (/\b(?:cross training|cross-training|xtrain|xt|alternativtraining)\b/.test(text)) crossTraining = true;

      const longRunHint = /\b(?:long run|lrl|lr)\b/.test(text);
      if (longRunHint && dayDistanceKm > 0) longRunCandidatesKm.push(dayDistanceKm);
    }

    if (populatedDays > 0) {
      daysPerWeekAccumulator += populatedDays;
      weeksWithData += 1;
      weeklyTotalsKm.push(Number(weekTotalKm.toFixed(2)));
      qualityDaysPerWeek.push(weekQualityDays);
    }
  }

  const daysPerWeek = weeksWithData > 0
    ? Math.max(1, Math.min(7, Math.round(daysPerWeekAccumulator / weeksWithData)))
    : 0;
  const peakWeekKm = weeklyTotalsKm.length ? Math.max(...weeklyTotalsKm) : null;
  const peakLongRunKm = longRunCandidatesKm.length ? Math.max(...longRunCandidatesKm) : null;

  let taperWeeks: number | null = null;
  if (weeklyTotalsKm.length >= 3) {
    const peak = Math.max(...weeklyTotalsKm);
    const peakIndex = weeklyTotalsKm.indexOf(peak);
    let trailingDecline = 0;
    for (let i = weeklyTotalsKm.length - 1; i > peakIndex; i -= 1) {
      const current = weeklyTotalsKm[i];
      const previous = weeklyTotalsKm[i - 1];
      if (previous > 0 && current <= previous * 0.92) trailingDecline += 1;
      else break;
    }
    if (trailingDecline > 0) taperWeeks = trailingDecline;
  }

  const structureTags: string[] = [];
  for (let i = 1; i < weeklyTotalsKm.length; i += 1) {
    const prev = weeklyTotalsKm[i - 1];
    const current = weeklyTotalsKm[i];
    if (prev > 0 && current <= prev * 0.78) {
      structureTags.push('cutback weeks');
      break;
    }
  }
  if (qualityDaysPerWeek.length && median(qualityDaysPerWeek) <= 1) {
    structureTags.push('one quality day');
  }
  if (weeklyTotalsKm.length >= 4) {
    let hasBuildThenDrop = false;
    for (let i = 3; i < weeklyTotalsKm.length; i += 1) {
      const w0 = weeklyTotalsKm[i - 3];
      const w1 = weeklyTotalsKm[i - 2];
      const w2 = weeklyTotalsKm[i - 1];
      const w3 = weeklyTotalsKm[i];
      if (w0 < w1 && w1 < w2 && w3 < w2 * 0.85) {
        hasBuildThenDrop = true;
        break;
      }
    }
    if (hasBuildThenDrop) structureTags.push('3-1 build');
  }
  if (taperWeeks && taperWeeks >= 1) structureTags.push('taper phase');

  return {
    plan_length_weeks: totalWeeks,
    days_per_week: daysPerWeek,
    distance_type: inferDistanceType(planName, peakLongRunKm),
    intensity_model: inferIntensityModel(weeks),
    units: inferUnits(weeks),
    language_hint: inferLanguage(weeks),
    includes_quality: {
      intervals,
      tempo,
      hills,
      strides,
      strength,
      cross_training: crossTraining
    },
    peak_week_km: peakWeekKm !== null ? Number(peakWeekKm.toFixed(1)) : null,
    peak_long_run_km: peakLongRunKm !== null ? Number(peakLongRunKm.toFixed(1)) : null,
    taper_weeks: taperWeeks,
    structure_tags: [...new Set(structureTags)]
  };
}
