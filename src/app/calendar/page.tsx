import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getDayDateFromWeekStart, resolveWeekBounds } from "@/lib/plan-dates";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { isDayMarkedDone } from "@/lib/day-status";
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from "@/lib/plan-selection";
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  type DistanceUnit
} from "@/lib/unit-display";
import AthleteSidebar from "@/components/AthleteSidebar";
import DayCompletionButton from "@/components/DayCompletionButton";
import RaceDetailsEditor from "@/components/RaceDetailsEditor";
import SelectedPlanCookie from "@/components/SelectedPlanCookie";
import "../dashboard/dashboard.css";
import "./calendar.css";

type CalendarSearchParams = {
  plan?: string;
  month?: string;
  date?: string;
};

type ActivityType =
  | "RUN"
  | "STRENGTH"
  | "CROSS_TRAIN"
  | "REST"
  | "MOBILITY"
  | "YOGA"
  | "HIKE"
  | "OTHER";

type DatedActivity = {
  id: string;
  title: string;
  type: ActivityType;
  completed: boolean;
  distance: number | null;
  duration: number | null;
  distanceUnit: "MILES" | "KM" | null;
  actualDistance: number | null;
  actualDuration: number | null;
  actualPace: string | null;
  notes: string | null;
};

type DayExternalLog = {
  id: string;
  provider: string;
  name: string;
  sportType: string | null;
  startTime: Date;
  distanceM: number | null;
  durationSec: number | null;
  avgHeartRate: number | null;
  calories: number | null;
  matchedPlanActivityId: string | null;
};

type DayInfo = {
  dayId: string;
  manualDone: boolean;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TYPE_GLOSSARY_ORDER: ActivityType[] = [
  "RUN",
  "STRENGTH",
  "CROSS_TRAIN",
  "REST",
  "MOBILITY",
  "YOGA",
  "HIKE",
  "OTHER"
];
const ACTIVITY_TYPE_ABBR: Record<ActivityType, string> = {
  RUN: "RUN",
  STRENGTH: "STR",
  CROSS_TRAIN: "XT",
  REST: "RST",
  MOBILITY: "MOB",
  YOGA: "YOG",
  HIKE: "HIK",
  OTHER: "OTH"
};

function normalizeDate(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getIsoDay(value: Date) {
  const day = value.getDay();
  return day === 0 ? 7 : day;
}

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function getTypeAbbr(type: string) {
  const key = (type in ACTIVITY_TYPE_ABBR ? type : "OTHER") as ActivityType;
  return ACTIVITY_TYPE_ABBR[key];
}

function dateKey(value: Date) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthParam(value: Date) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function parseMonthParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [yearStr, monthStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const d = new Date(year, month - 1, 1);
  return normalizeDate(d);
}

function parseDateParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return normalizeDate(parsed);
}

function addMonths(value: Date, delta: number) {
  const d = normalizeDate(value);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return d;
}

function formatMonthLabel(value: Date) {
  return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDateLabel(value: Date | null | undefined) {
  if (!value) return "Not set";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInputValue(value: Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildCalendarHref(month: Date, planId: string, selectedDate?: string | null) {
  const params = new URLSearchParams();
  params.set("month", monthParam(month));
  if (planId) params.set("plan", planId);
  if (selectedDate) params.set("date", selectedDate);
  return `/calendar?${params.toString()}`;
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDurationMinutes(value: number | null | undefined) {
  if (!value || value <= 0) return "—";
  return `${value} min`;
}

function formatDurationSeconds(value: number | null | undefined) {
  if (!value || value <= 0) return "—";
  return `${Math.round(value / 60)} min`;
}

function formatMinutesTotal(value: number) {
  if (value <= 0) return "0m";
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function formatDistance(
  value: number | null | undefined,
  unit: string | null | undefined,
  viewerUnit: DistanceUnit
) {
  const converted = convertDistanceForDisplay(value, unit, viewerUnit);
  if (!converted) return "—";
  return `${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`;
}

function formatDistanceMeters(value: number | null | undefined, viewerUnit: DistanceUnit) {
  if (!value || value <= 0) return "—";
  const converted = convertDistanceForDisplay(value / 1000, "KM", viewerUnit);
  if (!converted) return "—";
  return `${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`;
}

function formatPace(value: string | null | undefined, viewerUnit: DistanceUnit, sourceUnit?: string | null) {
  return convertPaceForDisplay(value, viewerUnit, sourceUnit || viewerUnit) || "—";
}

function getExternalDateKey(raw: unknown, startTime: Date) {
  if (raw && typeof raw === "object") {
    const payload = raw as Record<string, unknown>;
    const local = payload.start_date_local;
    if (typeof local === "string" && /^\d{4}-\d{2}-\d{2}/.test(local)) {
      return local.slice(0, 10);
    }
  }
  return dateKey(startTime);
}

export default async function CalendarPage({
  searchParams
}: {
  searchParams?: Promise<CalendarSearchParams>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const name = user.fullName || user.firstName || "Athlete";

  const syncedUser = await ensureUserFromAuth(user, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE"
  });
  const viewerUnits: DistanceUnit = syncedUser.units === "KM" ? "KM" : "MILES";

  const params = (await searchParams) || {};
  const requestedPlanId = typeof params.plan === "string" ? params.plan : "";
  const requestedMonth = typeof params.month === "string" ? params.month : undefined;
  const requestedDate = typeof params.date === "string" ? params.date : undefined;
  const cookieStore = await cookies();
  const cookiePlanId = cookieStore.get(SELECTED_PLAN_COOKIE)?.value || "";

  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: user.id, isTemplate: false },
    orderBy: { createdAt: "desc" },
    include: {
      weeks: {
        include: {
          days: {
            include: { activities: true }
          }
        }
      }
    }
  });

  if (plans.length === 0) redirect("/dashboard");

  const selectedPlan = pickSelectedPlan(plans, {
    requestedPlanId,
    cookiePlanId
  });
  if (!selectedPlan) redirect("/dashboard");

  const sourcePlanName = selectedPlan.sourceId
    ? (
      await prisma.trainingPlan.findUnique({
        where: { id: selectedPlan.sourceId },
        select: { name: true }
      })
    )?.name || null
    : null;

  const weeks = [...selectedPlan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((week) => week.weekIndex);

  const activitiesByDate = new Map<string, DatedActivity[]>();
  const dayInfoByDate = new Map<string, DayInfo>();
  const planDateKeys = new Set<string>();
  const alignedDates: Date[] = [];

  let derivedWeekCount = 0;
  let storedWeekCount = 0;

  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: selectedPlan.raceDate,
      weekCount: selectedPlan.weekCount,
      allWeekIndexes
    });

    if (bounds.source === "derived") derivedWeekCount += 1;
    if (bounds.source === "stored") storedWeekCount += 1;

    for (const day of week.days || []) {
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      if (!dayDate) continue;
      const key = dateKey(dayDate);
      planDateKeys.add(key);
      alignedDates.push(dayDate);
      if (!dayInfoByDate.has(key)) {
        dayInfoByDate.set(key, {
          dayId: day.id,
          manualDone: isDayMarkedDone(day.notes)
        });
      }

      for (const activity of day.activities || []) {
        const next: DatedActivity = {
          id: activity.id,
          title: activity.title || formatType(activity.type),
          type: (activity.type as ActivityType) || "OTHER",
          completed: !!activity.completed,
          distance: activity.distance ?? null,
          duration: activity.duration ?? null,
          distanceUnit: activity.distanceUnit ?? null,
          actualDistance: activity.actualDistance ?? null,
          actualDuration: activity.actualDuration ?? null,
          actualPace: activity.actualPace ?? null,
          notes: activity.notes ?? null
        };
        const existing = activitiesByDate.get(key) || [];
        existing.push(next);
        activitiesByDate.set(key, existing);
      }
    }
  }

  for (const [key, list] of activitiesByDate.entries()) {
    list.sort((a, b) => {
      if (a.type === "REST" && b.type !== "REST") return 1;
      if (a.type !== "REST" && b.type === "REST") return -1;
      return a.title.localeCompare(b.title);
    });
    activitiesByDate.set(key, list);
  }

  alignedDates.sort((a, b) => a.getTime() - b.getTime());
  const planStartDate = alignedDates.length > 0 ? alignedDates[0] : null;
  const planEndDate = alignedDates.length > 0 ? alignedDates[alignedDates.length - 1] : null;

  const today = normalizeDate(new Date());
  const requestedMonthDate = parseMonthParam(requestedMonth);
  const defaultMonth =
    requestedMonthDate
    || (
      planStartDate && planEndDate && today >= planStartDate && today <= planEndDate
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : planStartDate
          ? new Date(planStartDate.getFullYear(), planStartDate.getMonth(), 1)
          : new Date(today.getFullYear(), today.getMonth(), 1)
    );
  const monthStart = normalizeDate(defaultMonth);
  monthStart.setDate(1);
  const monthEnd = normalizeDate(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));

  const gridStart = normalizeDate(monthStart);
  gridStart.setDate(gridStart.getDate() - (getIsoDay(gridStart) - 1));
  const gridEnd = normalizeDate(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (7 - getIsoDay(gridEnd)));

  const dayCells: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    dayCells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const parsedRequestedDate = parseDateParam(requestedDate);
  const defaultSelectedDate =
    parsedRequestedDate
    || (
      today >= monthStart && today <= monthEnd
        ? today
        : monthStart
    );
  const selectedDateKey = dateKey(defaultSelectedDate);

  const prevMonthHref = buildCalendarHref(addMonths(monthStart, -1), selectedPlan.id, selectedDateKey);
  const nextMonthHref = buildCalendarHref(addMonths(monthStart, 1), selectedPlan.id, selectedDateKey);

  const externalRangeStart = normalizeDate(new Date(gridStart));
  const externalRangeEnd = normalizeDate(new Date(gridEnd));
  externalRangeEnd.setHours(23, 59, 59, 999);
  const externalActivitiesRaw = await prisma.externalActivity.findMany({
    where: {
      userId: user.id,
      startTime: {
        gte: externalRangeStart,
        lte: externalRangeEnd
      }
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      provider: true,
      name: true,
      sportType: true,
      startTime: true,
      distanceM: true,
      durationSec: true,
      avgHeartRate: true,
      calories: true,
      matchedPlanActivityId: true,
      raw: true
    }
  });

  const externalByDate = new Map<string, DayExternalLog[]>();
  for (const item of externalActivitiesRaw) {
    const key = getExternalDateKey(item.raw, item.startTime);
    const row = externalByDate.get(key) || [];
    row.push({
      id: item.id,
      provider: item.provider,
      name: item.name || item.sportType || "External activity",
      sportType: item.sportType,
      startTime: item.startTime,
      distanceM: item.distanceM ?? null,
      durationSec: item.durationSec ?? null,
      avgHeartRate: item.avgHeartRate ?? null,
      calories: item.calories ?? null,
      matchedPlanActivityId: item.matchedPlanActivityId ?? null
    });
    externalByDate.set(key, row);
  }

  const selectedDate = parsedRequestedDate || defaultSelectedDate;
  const selectedDayInfo = dayInfoByDate.get(selectedDateKey) || null;
  const selectedPlanActivities = activitiesByDate.get(selectedDateKey) || [];
  const selectedExternalLogs = externalByDate.get(selectedDateKey) || [];
  const selectedIsPastOrToday = selectedDate.getTime() <= today.getTime();
  const selectedDayAutoDone = selectedPlanActivities.length > 0 && selectedPlanActivities.every((activity) => activity.completed);
  const selectedDayDone = Boolean(selectedDayInfo?.manualDone || selectedDayAutoDone);

  const monthWorkoutCount = dayCells
    .filter((date) => date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear())
    .reduce((sum, date) => sum + (activitiesByDate.get(dateKey(date))?.length || 0), 0);
  const monthCompletedCount = dayCells
    .filter((date) => date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear())
    .reduce((sum, date) => sum + (activitiesByDate.get(dateKey(date))?.filter((a) => a.completed).length || 0), 0);
  const monthCompletionPct = monthWorkoutCount > 0
    ? Math.round((monthCompletedCount / monthWorkoutCount) * 100)
    : 0;
  const monthActivities = dayCells
    .filter((date) => date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear())
    .flatMap((date) => activitiesByDate.get(dateKey(date)) || []);
  const monthDistanceTotal = monthActivities.reduce((sum, activity) => {
    const converted = convertDistanceForDisplay(activity.distance, activity.distanceUnit, viewerUnits);
    return sum + (converted?.value || 0);
  }, 0);
  const monthDurationTotal = monthActivities.reduce((sum, activity) => sum + (activity.duration || 0), 0);

  return (
    <main className="dash cal-page">
      <SelectedPlanCookie planId={selectedPlan.id} />
      <div className="dash-grid">
        <AthleteSidebar active="calendar" name={name} />

        <section className="dash-center">
          <div className="dash-card cal-header">
            <div className="cal-header-title">
              <h1>Training Log</h1>
              <p>Month-by-month execution aligned to your active plan.</p>
            </div>
            <div className="cal-header-metrics">
              <div>
                <span>Monthly Distance</span>
                <strong>{formatDistanceNumber(monthDistanceTotal)} {distanceUnitLabel(viewerUnits)}</strong>
              </div>
              <div>
                <span>Monthly Time</span>
                <strong>{formatMinutesTotal(monthDurationTotal)}</strong>
              </div>
            </div>
            <div className="cal-header-actions">
              <div className="cal-view-toggle" aria-label="Plan views">
                <Link className="cal-view-pill" href={`/plans/${selectedPlan.id}`}>Plan</Link>
                <span className="cal-view-pill active">Calendar</span>
                <Link className="cal-view-pill" href="/strava">Import Strava</Link>
              </div>
              <div className="cal-month-nav">
                <Link className="cal-month-btn" href={prevMonthHref} aria-label="Previous month">
                  &larr; Prev
                </Link>
                <strong>{formatMonthLabel(monthStart)}</strong>
                <Link className="cal-month-btn" href={nextMonthHref} aria-label="Next month">
                  Next &rarr;
                </Link>
              </div>
            </div>
          </div>

          {plans.length > 1 && (
            <div className="dash-card cal-plan-switch">
              <span>Plan:</span>
              <div className="cal-plan-pills">
                {plans.map((plan) => {
                  const href = buildCalendarHref(monthStart, plan.id, selectedDateKey);
                  const isActive = plan.id === selectedPlan.id;
                  return (
                    <Link key={plan.id} href={href} className={`cal-plan-pill${isActive ? " active" : ""}`}>
                      {plan.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div className="dash-card cal-month-card">
            <div className="cal-weekdays">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="cal-weekday">{label}</div>
              ))}
            </div>

            <div className="cal-grid">
              {dayCells.map((date) => {
                const key = dateKey(date);
                const dayActivities = activitiesByDate.get(key) || [];
                const dayLogs = externalByDate.get(key) || [];
                const dayInfo = dayInfoByDate.get(key) || null;
                const isToday = key === dateKey(today);
                const isSelected = key === selectedDateKey;
                const isOutMonth = date.getMonth() !== monthStart.getMonth();
                const inPlan = planDateKeys.has(key);
                const dayAutoDone = dayActivities.length > 0 && dayActivities.every((activity) => activity.completed);
                const dayDone = Boolean(dayInfo?.manualDone || dayAutoDone);
                const moreCount = dayActivities.length > 3 ? dayActivities.length - 3 : 0;
                const dayHref = `${buildCalendarHref(monthStart, selectedPlan.id, key)}#day-details-card`;
                return (
                  <div
                    key={key}
                    className={[
                      "cal-day",
                      isOutMonth ? "out-month" : "",
                      isToday ? "today" : "",
                      isSelected ? "selected" : "",
                      dayDone ? "day-done" : "",
                      inPlan ? "in-plan" : ""
                    ].join(" ").trim()}
                  >
                    <Link className="cal-day-hit" href={dayHref} aria-label={`Open ${key}`} />
                    <div className="cal-day-head">
                      <span className="cal-day-number">{date.getDate()}</span>
                      <div className="cal-day-head-badges">
                        {dayDone && <span className="cal-day-check" title="Day completed">✓</span>}
                        {inPlan && <span className="cal-plan-dot" title="In plan window" />}
                      </div>
                    </div>

                    <div className="cal-day-list">
                      {dayActivities.slice(0, 3).map((activity) => (
                        <div
                          key={activity.id}
                          className={`cal-activity type-${activity.type.toLowerCase()}${activity.completed ? " completed" : ""}`}
                          title={activity.title}
                        >
                          <span className="cal-activity-title">
                            <span className={`cal-activity-code type-${activity.type.toLowerCase()}`}>
                              {getTypeAbbr(activity.type)}
                            </span>
                          </span>
                          {activity.completed && <em>Done</em>}
                        </div>
                      ))}
                      {moreCount > 0 && (
                        <span className="cal-more">
                          +{moreCount} more
                        </span>
                      )}
                      {dayLogs.length > 0 && (
                        <span className="cal-log-pill">
                          {dayLogs.length} log{dayLogs.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dash-card cal-type-glossary" aria-label="Activity type glossary">
            <div className="cal-type-glossary-head">
              <strong>Type Glossary</strong>
              <span>Abbreviations used in calendar cells</span>
            </div>
            <div className="cal-type-glossary-list">
              {TYPE_GLOSSARY_ORDER.map((type) => (
                <span key={type} className={`cal-type-chip type-${type.toLowerCase()}`}>
                  <em>{getTypeAbbr(type)}</em>
                  <span>{formatType(type)}</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        <aside className="dash-right">
          <div id="day-details-card" className="dash-card cal-info-card cal-day-details-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Day Details</span>
            </div>
            <p className="cal-day-detail-hint">Click any day card in the calendar to update this panel.</p>
            <div className="cal-day-detail-header">
              <strong>
                {selectedDate.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric"
                })}
              </strong>
              <div className="cal-day-detail-header-badges">
                {selectedDateKey === dateKey(today) && <span>TODAY</span>}
                {selectedDayDone && <span className="done">DONE</span>}
              </div>
            </div>

            {selectedDayInfo && (
              <DayCompletionButton
                dayId={selectedDayInfo.dayId}
                completed={selectedDayDone}
              />
            )}

            <div className="cal-day-detail-section">
              <h4>Training Plan</h4>
              {selectedPlanActivities.length === 0 && (
                <p className="cal-day-empty">No planned activities on this day.</p>
              )}
              {selectedPlanActivities.map((activity) => (
                <div key={activity.id} className={`cal-day-detail-item${activity.completed ? " done" : ""}`}>
                  <div className="cal-day-detail-title">
                    <span className="cal-day-detail-main">
                      <span
                        className={`cal-day-detail-type-pill type-${activity.type.toLowerCase()}`}
                        title={formatType(activity.type)}
                      >
                        {getTypeAbbr(activity.type)}
                      </span>
                      <strong>{activity.title}</strong>
                    </span>
                    <span>{formatType(activity.type)}</span>
                  </div>
                  <div className="cal-day-detail-meta">
                    <span>
                      Planned: {formatDistance(activity.distance, activity.distanceUnit, viewerUnits)} · {formatDurationMinutes(activity.duration)}
                    </span>
                    <span>Status: {activity.completed ? "Done" : "Planned"}</span>
                    {(activity.actualDistance || activity.actualDuration || activity.actualPace) && (
                      <span>
                        Logged: {formatDistance(activity.actualDistance, activity.distanceUnit, viewerUnits)} · {formatDurationMinutes(activity.actualDuration)}
                        {activity.actualPace ? ` · ${formatPace(activity.actualPace, viewerUnits, activity.distanceUnit)}` : ""}
                      </span>
                    )}
                    {activity.notes && <span>Notes: {activity.notes}</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="cal-day-detail-section">
              <h4>Logged Activities</h4>
              {!selectedIsPastOrToday && (
                <p className="cal-day-empty">Future day. Logs will appear after the activity date.</p>
              )}
              {selectedIsPastOrToday && selectedExternalLogs.length === 0 && (
                <p className="cal-day-empty">No synced external logs for this day.</p>
              )}
              {selectedIsPastOrToday && selectedExternalLogs.map((log) => (
                <div key={log.id} className="cal-day-detail-item log">
                  <div className="cal-day-detail-title">
                    <strong>{log.name}</strong>
                    <span>{log.provider} · {formatClock(log.startTime)}</span>
                  </div>
                  <div className="cal-day-detail-meta">
                    <span>{formatDistanceMeters(log.distanceM, viewerUnits)} · {formatDurationSeconds(log.durationSec)}</span>
                    {log.avgHeartRate ? <span>Avg HR: {log.avgHeartRate} bpm</span> : null}
                    {log.calories ? <span>Calories: {Math.round(log.calories)}</span> : null}
                    <span>{log.matchedPlanActivityId ? "Matched to plan activity" : "Not matched yet"}</span>
                  </div>
                </div>
              ))}
            </div>
            {selectedDayInfo && (
              <div className="cal-mobile-day-done">
                <DayCompletionButton
                  dayId={selectedDayInfo.dayId}
                  completed={selectedDayDone}
                />
              </div>
            )}
          </div>

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Selected Plan</span>
            </div>
            <div className="cal-info-list">
              <div>
                <strong>Plan name</strong>
                <span>{sourcePlanName || selectedPlan.name}</span>
              </div>
              <div>
                <strong>Race</strong>
                <span>{selectedPlan.raceName || "Not set"}</span>
              </div>
              <div>
                <strong>Race date</strong>
                <span>{formatDateLabel(selectedPlan.raceDate)}</span>
              </div>
              <div>
                <strong>Training window</strong>
                <span>{`${formatDateLabel(planStartDate)} - ${formatDateLabel(planEndDate)}`}</span>
              </div>
            </div>
            <RaceDetailsEditor
              planId={selectedPlan.id}
              initialRaceName={selectedPlan.raceName || ""}
              initialRaceDate={toDateInputValue(selectedPlan.raceDate)}
            />
          </div>

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">This Month</span>
            </div>
            <div className="cal-info-list">
              <div>
                <strong>Workouts</strong>
                <span>{monthWorkoutCount}</span>
              </div>
              <div>
                <strong>Completed</strong>
                <span>{monthCompletedCount}</span>
              </div>
              <div>
                <strong>Completion</strong>
                <span>{monthCompletionPct}%</span>
              </div>
              <div>
                <strong>Date alignment</strong>
                <span>
                  {derivedWeekCount > 0 && storedWeekCount === 0
                    ? "Race-derived"
                    : derivedWeekCount > 0
                      ? "Mixed (stored + race-derived)"
                      : "Stored week dates"}
                </span>
              </div>
            </div>
          </div>

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Quick Actions</span>
            </div>
            <div className="cal-links">
              <Link href={`/plans/${selectedPlan.id}`}>Open plan detail</Link>
              <Link href="/dashboard">Go to Today</Link>
              <Link href="/strava">Open Import Strava</Link>
              <Link href="/progress">View Progress</Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
