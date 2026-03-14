export type AiCoachIntent = 'status_check' | 'activity_feedback' | 'adjustment_request';

type WeekSummary = {
  weekIndex: number;
  startDateISO: string | null;
  endDateISO: string | null;
  restDays: number[];
  hardRunDays: number[];
  keySessionDays: number[];
  plannedDurationMin: number | null;
};

type DayActivity = {
  title: string;
  type: string;
  completed: boolean;
  duration: number | null;
  actualDuration?: number | null;
  distance?: number | null;
  actualDistance?: number | null;
  distanceUnit?: string | null;
  actualPace?: string | null;
};

type ContextDay = {
  weekIndex: number;
  dayOfWeek: number;
  dateISO: string | null;
  isLocked: boolean;
  activities: DayActivity[];
};

export type AiCoachPlanContext = {
  todayISO: string;
  weekSummaries: WeekSummary[];
  days: ContextDay[];
};

export type AiCoachWeekStatusScope = {
  weekIndex: number | null;
  weekSummary: WeekSummary | null;
  days: Array<{
    dayOfWeek: number;
    dateISO: string | null;
    isLocked: boolean;
    totalActivities: number;
    completedActivities: number;
    activityTitles: string[];
  }>;
  completedActivities: number;
  totalActivities: number;
  lockedDays: number;
};

export type AiCoachActivityFeedbackScope = {
  targetDateISO: string | null;
  currentWeekIndex: number | null;
  targetDay: {
    weekIndex: number;
    dayOfWeek: number;
    dateISO: string | null;
    isLocked: boolean;
    activities: DayActivity[];
  } | null;
  recentCompletedDays: Array<{
    weekIndex: number;
    dayOfWeek: number;
    dateISO: string | null;
    activities: DayActivity[];
  }>;
};

const STATUS_CHECK_PATTERNS = [
  /\bhow(?:'s| is)\s+my\s+week\b/i,
  /\bweek\s+so\s+far\b/i,
  /\bhow\s+am\s+i\s+doing\b/i,
  /\bam\s+i\s+on\s+track\b/i,
  /\bhow\s+does\s+this\s+week\s+look\b/i,
  /\bhow\s+is\s+training\s+going\b/i,
  /\bhow\s+am\s+i\s+tracking\b/i,
];

const ACTIVITY_FEEDBACK_PATTERNS = [
  /\bdoes\b[\s\S]*\bcount as\b/i,
  /\bcount as\b/i,
  /\byesterday('?s)?\b/i,
  /\bfrom yesterday\b/i,
  /\blogged\b/i,
  /\bcompleted\b/i,
  /\bwas that\b/i,
  /\bdoes that count\b/i,
];

const ADJUSTMENT_PATTERNS = [
  /\b(change|move|swap|reschedul|reduce|cut|add|remove|delete|rename|extend|adjust|shorten|increase)\b/i,
  /\b(can you|could you|please)\b[\s\S]*\b(change|move|swap|adjust|add|remove|delete|rename)\b/i,
];

function isoDateWithinRange(dateISO: string, startISO: string | null, endISO: string | null) {
  if (!startISO || !endISO) return false;
  return dateISO >= startISO && dateISO <= endISO;
}

export function detectAiCoachIntent(message: string): AiCoachIntent {
  if (ADJUSTMENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'adjustment_request';
  }
  if (ACTIVITY_FEEDBACK_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'activity_feedback';
  }
  if (STATUS_CHECK_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'status_check';
  }
  return 'adjustment_request';
}

function shiftIsoDate(dateISO: string, deltaDays: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function resolveCurrentWeekIndex(
  context: AiCoachPlanContext,
  requestedCurrentWeekIndex?: number | null
): number | null {
  if (
    typeof requestedCurrentWeekIndex === 'number'
    && context.weekSummaries.some((week) => week.weekIndex === requestedCurrentWeekIndex)
  ) {
    return requestedCurrentWeekIndex;
  }

  const activeWeek = context.weekSummaries.find((week) =>
    isoDateWithinRange(context.todayISO, week.startDateISO, week.endDateISO)
  );
  return activeWeek?.weekIndex ?? null;
}

export function buildWeekStatusScope(
  context: AiCoachPlanContext,
  requestedCurrentWeekIndex?: number | null
): AiCoachWeekStatusScope {
  const weekIndex = resolveCurrentWeekIndex(context, requestedCurrentWeekIndex);
  const weekSummary = context.weekSummaries.find((week) => week.weekIndex === weekIndex) ?? null;
  const days = context.days
    .filter((day) => day.weekIndex === weekIndex)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((day) => ({
      dayOfWeek: day.dayOfWeek,
      dateISO: day.dateISO,
      isLocked: day.isLocked,
      totalActivities: day.activities.length,
      completedActivities: day.activities.filter((activity) => activity.completed).length,
      activityTitles: day.activities.map((activity) => activity.title).filter(Boolean),
    }));

  return {
    weekIndex,
    weekSummary,
    days,
    completedActivities: days.reduce((sum, day) => sum + day.completedActivities, 0),
    totalActivities: days.reduce((sum, day) => sum + day.totalActivities, 0),
    lockedDays: days.filter((day) => day.isLocked).length,
  };
}

export function buildActivityFeedbackScope(
  message: string,
  context: AiCoachPlanContext,
  requestedCurrentWeekIndex?: number | null
): AiCoachActivityFeedbackScope {
  const currentWeekIndex = resolveCurrentWeekIndex(context, requestedCurrentWeekIndex);
  const normalizedMessage = message.toLowerCase();
  const targetDateISO = normalizedMessage.includes('yesterday')
    ? shiftIsoDate(context.todayISO, -1)
    : normalizedMessage.includes('today')
      ? context.todayISO
      : null;

  const targetDaySource = targetDateISO
    ? context.days.find((day) => day.dateISO === targetDateISO) ?? null
    : null;

  const fallbackRecentCompletedDays = [...context.days]
    .filter((day) => day.activities.some((activity) => activity.completed))
    .sort((a, b) => String(b.dateISO || '').localeCompare(String(a.dateISO || '')))
    .slice(0, 3);

  return {
    targetDateISO,
    currentWeekIndex,
    targetDay: targetDaySource
      ? {
        weekIndex: targetDaySource.weekIndex,
        dayOfWeek: targetDaySource.dayOfWeek,
        dateISO: targetDaySource.dateISO,
        isLocked: targetDaySource.isLocked,
        activities: targetDaySource.activities,
      }
      : null,
    recentCompletedDays: fallbackRecentCompletedDays.map((day) => ({
      weekIndex: day.weekIndex,
      dayOfWeek: day.dayOfWeek,
      dateISO: day.dateISO,
      activities: day.activities,
    })),
  };
}
