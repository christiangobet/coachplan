import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit,
} from '@/lib/unit-display';

export type LogActivity = {
  id: string;
  title: string | null;
  type: string;
  completed: boolean;
  plannedDetails: string[];
  plannedNotes: string | null;
  paceCategory: string | null;
  plannedDistance: number | null;
  plannedDuration: number | null;
  actualDistance: number | null;
  actualDuration: number | null;
  actualPace: string | null;
  // Raw fields needed for per-activity unit inference
  distanceUnit: 'MILES' | 'KM' | null;
  paceTarget: string | null;
  sessionInstructions: string | null;
  sessionGroupId: string | null;
  sessionOrder: number | null;
};

export function buildPlannedMetricParts(activity: any, viewerUnits: DistanceUnit): string[] {
  if (!activity) return [];
  const parts: string[] = [];
  const plannedSourceUnit =
    resolveDistanceUnitFromActivity({
      distanceUnit: activity.distanceUnit,
      paceTarget: activity.paceTarget,
      actualPace: activity.actualPace,
      fallbackUnit: viewerUnits,
    }) || viewerUnits;
  const plannedDistance = convertDistanceForDisplay(activity.distance, plannedSourceUnit, viewerUnits);
  if (plannedDistance) {
    parts.push(`${formatDistanceNumber(plannedDistance.value)} ${distanceUnitLabel(plannedDistance.unit)}`);
  }
  if (activity.duration) {
    parts.push(`${activity.duration} min`);
  }
  const paceConverted = convertPaceForDisplay(activity.paceTarget, viewerUnits, plannedSourceUnit);
  const paceText =
    paceConverted || (typeof activity.paceTarget === 'string' ? activity.paceTarget.trim() : '');
  if (paceText) {
    parts.push(`Pace ${paceText}`);
  }
  return parts;
}

export function buildLogActivities(rawActivities: any[], viewerUnits: DistanceUnit): LogActivity[] {
  return [...rawActivities]
    .sort((a, b) => (a.type === 'REST' ? 1 : 0) - (b.type === 'REST' ? 1 : 0))
    .map((activity) => {
      const plannedSourceUnit =
        resolveDistanceUnitFromActivity({
          distanceUnit: activity.distanceUnit,
          paceTarget: activity.paceTarget,
          actualPace: activity.actualPace,
          fallbackUnit: viewerUnits,
        }) || viewerUnits;
      const actualSourceUnit =
        resolveDistanceUnitFromActivity({
          distanceUnit: activity.distanceUnit,
          paceTarget: activity.paceTarget,
          actualPace: activity.actualPace,
          fallbackUnit: plannedSourceUnit,
          preferActualPace: true,
        }) || plannedSourceUnit;
      const displayPlannedDistance = convertDistanceForDisplay(activity.distance, plannedSourceUnit, viewerUnits);
      const displayActualDistance = convertDistanceForDisplay(activity.actualDistance, actualSourceUnit, viewerUnits);
      const displayActualPace = convertPaceForDisplay(activity.actualPace, viewerUnits, actualSourceUnit);
      return {
        id: activity.id,
        title: activity.title || null,
        type: activity.type || 'OTHER',
        completed: Boolean(activity.completed),
        plannedDetails: buildPlannedMetricParts(activity, viewerUnits),
        plannedNotes:
          typeof activity.rawText === 'string' && activity.rawText.trim()
            ? activity.rawText.trim()
            : null,
        paceCategory:
          typeof activity.paceTargetBucket === 'string' && activity.paceTargetBucket.trim()
            ? activity.paceTargetBucket
            : null,
        plannedDistance: displayPlannedDistance?.value ?? null,
        plannedDuration: activity.duration ?? null,
        actualDistance: displayActualDistance?.value ?? null,
        actualDuration: activity.actualDuration ?? null,
        actualPace: displayActualPace || null,
        distanceUnit: activity.distanceUnit ?? null,
        paceTarget: activity.paceTarget ?? null,
        sessionInstructions: typeof activity.sessionInstructions === 'string' && activity.sessionInstructions.trim()
          ? activity.sessionInstructions.trim()
          : null,
        sessionGroupId: activity.sessionGroupId ?? null,
        sessionOrder: activity.sessionOrder ?? null,
      };
    });
}
