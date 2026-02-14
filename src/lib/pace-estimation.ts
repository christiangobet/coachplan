export type PaceEvidenceSource = 'MANUAL' | 'STRAVA';

export type PaceEvidence = {
  source: PaceEvidenceSource;
  label?: string | null;
  distanceKm: number;
  timeSec: number;
  dateISO?: string | null;
};

export type PaceEstimateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type PaceEstimate = {
  goalTimeSec: number;
  confidence: PaceEstimateConfidence;
  evidenceUsed: number;
  spreadSec: number;
};

const RIEGEL_EXPONENT = 1.06;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function confidenceFrom(evidenceUsed: number, spreadSec: number): PaceEstimateConfidence {
  if (evidenceUsed >= 3 && spreadSec <= 300) return 'HIGH';
  if (evidenceUsed >= 2 && spreadSec <= 600) return 'MEDIUM';
  return 'LOW';
}

function parsedDate(dateISO?: string | null) {
  if (!dateISO) return null;
  const parsed = new Date(dateISO);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function recencyWeight(dateISO?: string | null) {
  const parsed = parsedDate(dateISO);
  if (!parsed) return 0.7;
  const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= 90) return 1.0;
  if (ageDays <= 180) return 0.9;
  if (ageDays <= 365) return 0.8;
  if (ageDays <= 730) return 0.65;
  return 0.5;
}

export function projectTimeWithRiegel(args: {
  sourceDistanceKm: number;
  sourceTimeSec: number;
  targetDistanceKm: number;
}) {
  const sourceDistanceKm = Math.max(0.1, args.sourceDistanceKm);
  const sourceTimeSec = Math.max(60, args.sourceTimeSec);
  const targetDistanceKm = Math.max(0.1, args.targetDistanceKm);
  const ratio = targetDistanceKm / sourceDistanceKm;
  return sourceTimeSec * Math.pow(ratio, RIEGEL_EXPONENT);
}

export function estimateGoalTimeFromEvidence(args: {
  targetDistanceKm: number;
  evidence: PaceEvidence[];
}) {
  const targetDistanceKm = Math.max(0.1, args.targetDistanceKm);

  const cleanEvidence = args.evidence.filter((item) => (
    Number.isFinite(item.distanceKm)
    && item.distanceKm > 0
    && Number.isFinite(item.timeSec)
    && item.timeSec >= 60
  ));

  if (cleanEvidence.length === 0) return null;

  const projectedValues = cleanEvidence.map((item) => {
    const projected = projectTimeWithRiegel({
      sourceDistanceKm: item.distanceKm,
      sourceTimeSec: item.timeSec,
      targetDistanceKm
    });

    const distanceRatio = targetDistanceKm / item.distanceKm;
    const relevancePenalty = Math.abs(Math.log(distanceRatio));
    const relevanceWeight = clamp(1 - relevancePenalty / 2.5, 0.35, 1);
    const weight = recencyWeight(item.dateISO) * relevanceWeight;

    return {
      projected,
      weight
    };
  });

  const totalWeight = projectedValues.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  const weightedMean = projectedValues.reduce((sum, item) => sum + item.projected * item.weight, 0) / totalWeight;
  const spreadSec = projectedValues.length > 1
    ? Math.max(...projectedValues.map((item) => item.projected)) - Math.min(...projectedValues.map((item) => item.projected))
    : 0;

  const estimate: PaceEstimate = {
    goalTimeSec: Math.round(weightedMean),
    confidence: confidenceFrom(projectedValues.length, spreadSec),
    evidenceUsed: projectedValues.length,
    spreadSec: Math.round(spreadSec)
  };

  return estimate;
}

export function formatTimeHms(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseTimePartsToSeconds(hours: unknown, minutes: unknown, seconds: unknown) {
  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  const s = Number(seconds || 0);
  if (![h, m, s].every((value) => Number.isFinite(value) && value >= 0)) return null;
  if (m >= 60 || s >= 60) return null;
  return Math.round(h * 3600 + m * 60 + s);
}
