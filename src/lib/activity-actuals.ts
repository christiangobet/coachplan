import { Prisma, Units } from '@prisma/client';

type BuildPlanActivityActualsUpdateArgs = {
  markCompleted?: boolean;
  completedAt?: Date;
  actualDistance?: number | null;
  actualDuration?: number | null;
  actualPace?: string | null;
  notes?: string | null;
  inferredDistanceUnit?: Units | null;
  existingDistanceUnit?: Units | null;
};

// Build update payloads for actual logging only. Planned workout fields must remain untouched.
export function buildPlanActivityActualsUpdate(
  args: BuildPlanActivityActualsUpdateArgs
): Prisma.PlanActivityUpdateInput {
  const data: Prisma.PlanActivityUpdateInput = {};

  if (args.markCompleted) {
    data.completed = true;
    data.completedAt = args.completedAt ?? new Date();
  }

  if (
    args.inferredDistanceUnit
    && !args.existingDistanceUnit
    && args.actualDistance !== undefined
    && args.actualDistance !== null
  ) {
    data.distanceUnit = args.inferredDistanceUnit;
  }

  if (args.actualDistance !== undefined) {
    data.actualDistance = args.actualDistance;
  }
  if (args.actualDuration !== undefined) {
    data.actualDuration = args.actualDuration;
  }
  if (args.actualPace !== undefined) {
    data.actualPace = args.actualPace;
  }
  if (args.notes !== undefined) {
    data.notes = args.notes;
  }

  return data;
}
