import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import {
  convertDistanceValue,
  convertPaceForDisplay,
  normalizeDistanceUnit,
  type DistanceUnit
} from '@/lib/unit-display';

function hasField(obj: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseOptionalPositiveNumber(
  body: Record<string, unknown>,
  field: string,
  max: number
): { provided: boolean; value?: number | null; error?: string } {
  if (!hasField(body, field)) return { provided: false };

  const raw = body[field];
  if (raw === null || raw === '') return { provided: true, value: null };

  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { provided: true, error: `${field} must be a positive number` };
  }
  if (numeric > max) {
    return { provided: true, error: `${field} is too large` };
  }

  return { provided: true, value: numeric };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const bodyRaw = await req.json().catch(() => ({}));
  if (!bodyRaw || typeof bodyRaw !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  const activity = await prisma.planActivity.findUnique({
    where: { id },
    include: { plan: true }
  });
  if (!activity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (activity.plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const actualDistance = parseOptionalPositiveNumber(body, 'actualDistance', 1000);
  if (actualDistance.error) return NextResponse.json({ error: actualDistance.error }, { status: 400 });

  const actualDuration = parseOptionalPositiveNumber(body, 'actualDuration', 2000);
  if (actualDuration.error) return NextResponse.json({ error: actualDuration.error }, { status: 400 });

  let providedUnit: DistanceUnit | null | undefined = undefined;
  if (hasField(body, 'actualDistanceUnit')) {
    const rawUnit = body.actualDistanceUnit;
    if (rawUnit === null || rawUnit === '') {
      providedUnit = null;
    } else if (typeof rawUnit === 'string') {
      const parsed = normalizeDistanceUnit(rawUnit);
      if (!parsed) {
        return NextResponse.json({ error: 'actualDistanceUnit must be KM or MILES' }, { status: 400 });
      }
      providedUnit = parsed;
    } else {
      return NextResponse.json({ error: 'actualDistanceUnit must be text' }, { status: 400 });
    }
  }

  let actualPace: string | null | undefined;
  if (hasField(body, 'actualPace')) {
    const rawPace = body.actualPace;
    if (rawPace === null || rawPace === '') {
      actualPace = null;
    } else if (typeof rawPace !== 'string') {
      return NextResponse.json({ error: 'actualPace must be text' }, { status: 400 });
    } else {
      const trimmed = rawPace.trim();
      if (!trimmed) {
        actualPace = null;
      } else if (trimmed.length > 40) {
        return NextResponse.json({ error: 'actualPace is too long' }, { status: 400 });
      } else {
        actualPace = trimmed;
      }
    }
  }

  let notes: string | null | undefined;
  if (hasField(body, 'notes')) {
    const rawNotes = body.notes;
    if (rawNotes === null || rawNotes === '') {
      notes = null;
    } else if (typeof rawNotes !== 'string') {
      return NextResponse.json({ error: 'notes must be text' }, { status: 400 });
    } else {
      const trimmed = rawNotes.trim();
      if (trimmed.length > 1000) {
        return NextResponse.json({ error: 'notes is too long' }, { status: 400 });
      }
      notes = trimmed || null;
    }
  }

  if (
    !actualDistance.provided &&
    !actualDuration.provided &&
    !hasField(body, 'actualPace') &&
    !hasField(body, 'notes')
  ) {
    return NextResponse.json({ error: 'No actual fields provided' }, { status: 400 });
  }

  const storageUnit = normalizeDistanceUnit(activity.distanceUnit);
  let resolvedActualDistance = actualDistance.provided ? actualDistance.value : undefined;
  if (
    resolvedActualDistance !== undefined
    && resolvedActualDistance !== null
    && storageUnit
    && providedUnit
    && providedUnit !== storageUnit
  ) {
    resolvedActualDistance = Number(
      convertDistanceValue(resolvedActualDistance, providedUnit, storageUnit).toFixed(2)
    );
  }

  if (typeof actualPace === 'string' && actualPace && storageUnit) {
    const sourceUnit = providedUnit || storageUnit;
    actualPace = convertPaceForDisplay(actualPace, storageUnit, sourceUnit) || actualPace;
  }

  const updated = await prisma.planActivity.update({
    where: { id: activity.id },
    data: {
      actualDistance: resolvedActualDistance,
      actualDuration: actualDuration.provided ? actualDuration.value : undefined,
      actualPace,
      notes
    }
  });

  return NextResponse.json({ activity: updated });
}
