import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { Difficulty, Prisma, RaceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const MAX_TEMPLATE_WEEKS = 520;

function parseEnumFilter<TValue extends string>(
  rawValue: string | null,
  allowedValues: readonly TValue[],
  fieldName: string
): { ok: true; value: TValue | null } | { ok: false; error: string } {
  if (!rawValue) return { ok: true, value: null };
  if ((allowedValues as readonly string[]).includes(rawValue)) {
    return { ok: true, value: rawValue as TValue };
  }
  return { ok: false, error: `${fieldName} must be a valid option` };
}

function parseWeekBound(rawValue: string | null, fieldName: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (!rawValue) return { ok: true, value: null };
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TEMPLATE_WEEKS) {
    return { ok: false, error: `${fieldName} must be an integer between 1 and ${MAX_TEMPLATE_WEEKS}` };
  }
  return { ok: true, value: parsed };
}

function parseWeeksFilter(
  minWeeksRaw: string | null,
  maxWeeksRaw: string | null
): { ok: true; value: Prisma.IntNullableFilter | undefined } | { ok: false; error: string } {
  const minWeeks = parseWeekBound(minWeeksRaw, 'minWeeks');
  if (!minWeeks.ok) return minWeeks;

  const maxWeeks = parseWeekBound(maxWeeksRaw, 'maxWeeks');
  if (!maxWeeks.ok) return maxWeeks;

  if (minWeeks.value !== null && maxWeeks.value !== null && minWeeks.value > maxWeeks.value) {
    return { ok: false, error: 'minWeeks must be less than or equal to maxWeeks' };
  }

  if (minWeeks.value === null && maxWeeks.value === null) {
    return { ok: true, value: undefined };
  }

  return {
    ok: true,
    value: {
      ...(minWeeks.value !== null ? { gte: minWeeks.value } : {}),
      ...(maxWeeks.value !== null ? { lte: maxWeeks.value } : {}),
    }
  };
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const raceType = url.searchParams.get('raceType');
  const difficulty = url.searchParams.get('difficulty');
  const minWeeks = url.searchParams.get('minWeeks');
  const maxWeeks = url.searchParams.get('maxWeeks');

  const raceTypeFilter = parseEnumFilter(raceType, Object.values(RaceType), 'raceType');
  if (!raceTypeFilter.ok) {
    return NextResponse.json({ error: raceTypeFilter.error }, { status: 400 });
  }

  const difficultyFilter = parseEnumFilter(difficulty, Object.values(Difficulty), 'difficulty');
  if (!difficultyFilter.ok) {
    return NextResponse.json({ error: difficultyFilter.error }, { status: 400 });
  }

  const weeksFilter = parseWeeksFilter(minWeeks, maxWeeks);
  if (!weeksFilter.ok) {
    return NextResponse.json({ error: weeksFilter.error }, { status: 400 });
  }

  const where: Prisma.TrainingPlanWhereInput = { isTemplate: true, isPublic: true };
  if (raceTypeFilter.value) where.raceType = raceTypeFilter.value;
  if (difficultyFilter.value) where.difficulty = difficultyFilter.value;
  if (weeksFilter.value) where.weekCount = weeksFilter.value;

  const templates = await prisma.trainingPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      weekCount: true,
      raceType: true,
      difficulty: true,
      ownerId: true,
      createdAt: true,
      planGuide: true,
      planSummary: true,
      owner: { select: { name: true } },
    },
  });

  return NextResponse.json({ templates });
}
