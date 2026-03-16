import { prisma } from '@/lib/prisma';

type PlanWithRelations = {
  weeks: {
    id: string;
    weekIndex: number;
    startDate: Date | null;
    endDate: Date | null;
    days: {
      id: string;
      dayOfWeek: number;
      rawText: string | null;
      notes: string | null;
      activities: {
        type: string;
        subtype: string | null;
        title: string;
        rawText: string | null;
        distance: number | null;
        distanceUnit: string | null;
        duration: number | null;
        paceTarget: string | null;
        effortTarget: string | null;
        paceTargetMode: 'SYMBOLIC' | 'NUMERIC' | 'RANGE' | 'HYBRID' | 'UNKNOWN' | null;
        paceTargetBucket: 'RECOVERY' | 'EASY' | 'LONG' | 'RACE' | 'TEMPO' | 'THRESHOLD' | 'INTERVAL' | null;
        paceTargetMinSec: number | null;
        paceTargetMaxSec: number | null;
        paceTargetUnit: string | null;
        effortTargetType: 'RPE' | 'HR_ZONE' | 'HR_BPM' | 'TEXT' | null;
        effortTargetMin: number | null;
        effortTargetMax: number | null;
        effortTargetZone: number | null;
        effortTargetBpmMin: number | null;
        effortTargetBpmMax: number | null;
        structure: any;
        tags: any;
        priority: string | null;
        bailAllowed: boolean;
        mustDo: boolean;
        notes: string | null;
        sessionGroupId: string | null;
        sessionOrder: number | null;
      }[];
    }[];
  }[];
};

/**
 * Deep-clone weeks, days, and activities from a source plan into a target plan.
 * Returns a map of old weekId → new weekId for date alignment.
 */
export async function clonePlanStructure(
  source: PlanWithRelations,
  targetPlanId: string
): Promise<{ weekMap: Record<string, string> }> {
  const weekMap: Record<string, string> = {};
  const dayMap: Record<string, string> = {};

  for (const week of source.weeks) {
    const created = await prisma.planWeek.create({
      data: {
        planId: targetPlanId,
        weekIndex: week.weekIndex,
        startDate: week.startDate,
        endDate: week.endDate,
      },
    });
    weekMap[week.id] = created.id;

    for (const day of week.days) {
      const createdDay = await prisma.planDay.create({
        data: {
          planId: targetPlanId,
          weekId: created.id,
          dayOfWeek: day.dayOfWeek,
          rawText: day.rawText || null,
          notes: day.notes || null,
        },
      });
      dayMap[day.id] = createdDay.id;
    }
  }

  const activities = source.weeks.flatMap((week) =>
    week.days.flatMap((day) =>
      day.activities.map((a) => ({
        planId: targetPlanId,
        dayId: dayMap[day.id],
        type: a.type as any,
        subtype: a.subtype || null,
        title: a.title,
        rawText: a.rawText || null,
        distance: a.distance || null,
        distanceUnit: a.distanceUnit as any || null,
        duration: a.duration || null,
        paceTarget: a.paceTarget || null,
        effortTarget: a.effortTarget || null,
        paceTargetMode: a.paceTargetMode ?? null,
        paceTargetBucket: a.paceTargetBucket ?? null,
        paceTargetMinSec: a.paceTargetMinSec ?? null,
        paceTargetMaxSec: a.paceTargetMaxSec ?? null,
        paceTargetUnit: a.paceTargetUnit as any ?? null,
        effortTargetType: a.effortTargetType ?? null,
        effortTargetMin: a.effortTargetMin ?? null,
        effortTargetMax: a.effortTargetMax ?? null,
        effortTargetZone: a.effortTargetZone ?? null,
        effortTargetBpmMin: a.effortTargetBpmMin ?? null,
        effortTargetBpmMax: a.effortTargetBpmMax ?? null,
        structure: a.structure || undefined,
        tags: a.tags || undefined,
        priority: a.priority as any || null,
        bailAllowed: a.bailAllowed,
        mustDo: a.mustDo,
        notes: a.notes || null,
        sessionGroupId: a.sessionGroupId ?? null,
        sessionOrder: a.sessionOrder ?? null,
      }))
    )
  );

  if (activities.length) {
    await prisma.planActivity.createMany({ data: activities });
  }

  return { weekMap };
}

/**
 * Align week dates backward from a race date.
 * The last week ends on the Sunday of race week.
 */
export async function alignWeeksToRaceDate(
  planId: string,
  totalWeeks: number,
  raceDate: Date
): Promise<void> {
  // Find the Sunday of race week (race week ends on Sunday) — all ops in UTC
  const raceSunday = new Date(raceDate);
  raceSunday.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = raceSunday.getUTCDay(); // 0=Sunday
  if (dayOfWeek !== 0) {
    raceSunday.setUTCDate(raceSunday.getUTCDate() + (7 - dayOfWeek));
  }

  for (let i = totalWeeks; i >= 1; i--) {
    const weeksFromEnd = totalWeeks - i;
    const endDate = new Date(raceSunday);
    endDate.setUTCDate(endDate.getUTCDate() - weeksFromEnd * 7);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6); // Monday

    await prisma.planWeek.updateMany({
      where: { planId, weekIndex: i },
      data: { startDate, endDate },
    });
  }
}

/**
 * Align week dates forward from a training start date.
 * Week 1 starts on the provided date and each subsequent week spans 7 days.
 */
export async function alignWeeksToStartDate(
  planId: string,
  totalWeeks: number,
  startDate: Date
): Promise<void> {
  const normalizedStart = new Date(startDate);
  normalizedStart.setUTCHours(0, 0, 0, 0);

  for (let i = 1; i <= totalWeeks; i++) {
    const weekStart = new Date(normalizedStart);
    weekStart.setUTCDate(weekStart.getUTCDate() + (i - 1) * 7);

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    await prisma.planWeek.updateMany({
      where: { planId, weekIndex: i },
      data: { startDate: weekStart, endDate: weekEnd },
    });
  }
}
