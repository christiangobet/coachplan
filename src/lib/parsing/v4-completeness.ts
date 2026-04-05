export type V4CompletenessWeek = {
  week_number: number;
};

export type V4CompletenessData = {
  program?: {
    plan_length_weeks?: number | null;
  } | null;
  weeks: V4CompletenessWeek[];
};

export type V4SinglePassLike = {
  truncated?: boolean;
  validated?: boolean;
  data?: V4CompletenessData | null;
};

export function isSinglePassIncomplete(
  single: V4SinglePassLike,
  planLengthWeeks?: number,
  expectedWeekNumbers?: number[],
) {
  if (single.truncated) return true;
  if (!single.validated || !single.data) return false;

  if (expectedWeekNumbers && expectedWeekNumbers.length > 0) {
    const seen = new Set(single.data.weeks.map((week) => week.week_number));
    return expectedWeekNumbers.some((weekNumber) => !seen.has(weekNumber));
  }

  const expectedFromMeta = single.data.program?.plan_length_weeks ?? planLengthWeeks ?? 0;
  if (expectedFromMeta <= 0) return false;

  const seen = new Set(single.data.weeks.map((week) => week.week_number));
  for (let weekNumber = 1; weekNumber <= expectedFromMeta; weekNumber += 1) {
    if (!seen.has(weekNumber)) return true;
  }
  return false;
}
