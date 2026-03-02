import type { ProgramJsonV1 } from '../schemas/program-json-v1';

export type WeekRange = {
  start: number;
  end: number;
};

export function buildWeekRanges(maxWeek = 25, chunkSize = 5): WeekRange[] {
  const ranges: WeekRange[] = [];
  for (let start = 1; start <= maxWeek; start += chunkSize) {
    ranges.push({ start, end: Math.min(maxWeek, start + chunkSize - 1) });
  }
  return ranges;
}

export function formatWeekRange(range: WeekRange): string {
  return `${range.start} through ${range.end}`;
}

export function splitWeekRange(range: WeekRange, chunkSize = 3): WeekRange[] {
  const ranges: WeekRange[] = [];
  for (let start = range.start; start <= range.end; start += chunkSize) {
    ranges.push({ start, end: Math.min(range.end, start + chunkSize - 1) });
  }
  return ranges;
}

export function mergeWeeksFromPasses(passes: Array<{ data: ProgramJsonV1 | null }>): ProgramJsonV1['weeks'] {
  const weekMap = new Map<number, ProgramJsonV1['weeks'][number]>();
  for (const pass of passes) {
    if (!pass.data) continue;
    for (const week of pass.data.weeks) {
      weekMap.set(week.week_number, week);
    }
  }
  return [...weekMap.values()].sort((a, b) => a.week_number - b.week_number);
}

export function inferExpectedWeekCount(
  successfulPasses: Array<{ data: ProgramJsonV1 }>,
  mergedWeeks: ProgramJsonV1['weeks']
): number {
  const fromProgramMeta = successfulPasses.reduce((max, pass) => {
    const weeks = pass.data.program.plan_length_weeks ?? 0;
    return weeks > max ? weeks : max;
  }, 0);
  const fromObserved = mergedWeeks.reduce((max, week) => {
    return week.week_number > max ? week.week_number : max;
  }, 0);
  return Math.max(fromProgramMeta, fromObserved);
}

export function findMissingWeekNumbers(weeks: ProgramJsonV1['weeks'], expectedWeekCount: number): number[] {
  if (expectedWeekCount <= 0) return [];
  const present = new Set(weeks.map((w) => w.week_number));
  const missing: number[] = [];
  for (let week = 1; week <= expectedWeekCount; week += 1) {
    if (!present.has(week)) missing.push(week);
  }
  return missing;
}

export function findMissingWeekRanges(weeks: ProgramJsonV1['weeks'], expectedWeekCount: number): WeekRange[] {
  const missing = findMissingWeekNumbers(weeks, expectedWeekCount);
  if (missing.length === 0) return [];

  const ranges: WeekRange[] = [];
  let start = missing[0];
  let prev = missing[0];
  for (let i = 1; i < missing.length; i += 1) {
    const current = missing[i];
    if (current !== prev + 1) {
      ranges.push({ start, end: prev });
      start = current;
    }
    prev = current;
  }
  ranges.push({ start, end: prev });
  return ranges;
}
