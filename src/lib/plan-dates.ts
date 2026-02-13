type DateInput = Date | string | null | undefined;

function normalizeDate(input: DateInput): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getDayDateFromWeekStart(weekStartDate: DateInput, dayOfWeek: number): Date | null {
  const start = normalizeDate(weekStartDate);
  if (!start) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + (dayOfWeek - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getRaceWeekSunday(raceDate: DateInput): Date | null {
  const race = normalizeDate(raceDate);
  if (!race) return null;
  const sunday = new Date(race);
  const dayOfWeek = sunday.getDay();
  if (dayOfWeek !== 0) sunday.setDate(sunday.getDate() + (7 - dayOfWeek));
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

function getTotalWeeks(weekIndexes: number[], weekCount?: number | null): number {
  const maxWeekIndex = weekIndexes.reduce((max, idx) => (idx > max ? idx : max), 0);
  return Math.max(weekCount || 0, maxWeekIndex);
}

export type ResolvedWeekBounds = {
  startDate: Date | null;
  endDate: Date | null;
  source: 'stored' | 'derived' | 'none';
};

type ResolveWeekBoundsInput = {
  weekIndex: number;
  weekStartDate?: DateInput;
  weekEndDate?: DateInput;
  raceDate?: DateInput;
  weekCount?: number | null;
  allWeekIndexes: number[];
};

export function resolveWeekBounds(input: ResolveWeekBoundsInput): ResolvedWeekBounds {
  const storedStart = normalizeDate(input.weekStartDate);
  const storedEnd = normalizeDate(input.weekEndDate);
  if (storedStart) {
    if (storedEnd) return { startDate: storedStart, endDate: storedEnd, source: 'stored' };
    const derivedEnd = new Date(storedStart);
    derivedEnd.setDate(derivedEnd.getDate() + 6);
    derivedEnd.setHours(0, 0, 0, 0);
    return { startDate: storedStart, endDate: derivedEnd, source: 'stored' };
  }

  const totalWeeks = getTotalWeeks(input.allWeekIndexes, input.weekCount);
  const raceSunday = getRaceWeekSunday(input.raceDate);
  if (!raceSunday || totalWeeks <= 0 || input.weekIndex <= 0) {
    return { startDate: null, endDate: null, source: 'none' };
  }

  const weeksFromEnd = totalWeeks - input.weekIndex;
  const endDate = new Date(raceSunday);
  endDate.setDate(endDate.getDate() - weeksFromEnd * 7);
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate, source: 'derived' };
}
