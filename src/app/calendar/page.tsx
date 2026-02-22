import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getDayDateFromWeekStart, resolveWeekBounds } from "@/lib/plan-dates";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { getDayMissedReason, getDayStatus, type DayStatus } from "@/lib/day-status";
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from "@/lib/plan-selection";
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit
} from "@/lib/unit-display";
import AthleteSidebar from "@/components/AthleteSidebar";
import CalendarActivityLogger from "@/components/CalendarActivityLogger";
import DayCompletionButton from "@/components/DayCompletionButton";
import ExternalSportIcon from "@/components/ExternalSportIcon";
import RaceDetailsEditor from "@/components/RaceDetailsEditor";
import SelectedPlanCookie from "@/components/SelectedPlanCookie";
import StravaDaySyncButton from "@/components/StravaDaySyncButton";
import "../dashboard/dashboard.css";
import "./calendar.css";

type CalendarSearchParams = {
  plan?: string;
  month?: string;
  date?: string;
  returnTo?: string;
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
  subtype: string | null;
  completed: boolean;
  completedAt: Date | null;
  distance: number | null;
  duration: number | null;
  distanceUnit: "MILES" | "KM" | null;
  paceTarget: string | null;
  effortTarget: string | null;
  priority: "KEY" | "MEDIUM" | "OPTIONAL" | null;
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
  startTimeLabel: string | null;
  distanceM: number | null;
  durationSec: number | null;
  avgHeartRate: number | null;
  calories: number | null;
  matchedPlanActivityId: string | null;
};

type DayInfo = {
  dayId: string;
  manualStatus: DayStatus;
  missedReason: string | null;
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

function formatProviderName(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toUpperCase();
  if (normalized === "STRAVA") return "Strava";
  if (normalized === "GARMIN") return "Garmin";
  return provider || "External";
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

function dateKeyUtc(value: Date) {
  return value.toISOString().slice(0, 10);
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

function buildCalendarHref(month: Date, planId: string, selectedDate?: string | null, returnTo?: string | null) {
  const params = new URLSearchParams();
  params.set("month", monthParam(month));
  if (planId) params.set("plan", planId);
  if (selectedDate) params.set("date", selectedDate);
  if (returnTo === "dashboard") params.set("returnTo", returnTo);
  return `/calendar?${params.toString()}`;
}

function buildAdjustHref(planId: string, prompt: string) {
  const params = new URLSearchParams();
  params.set("aiPrompt", prompt);
  params.set("aiSource", "calendar");
  return `/plans/${planId}?${params.toString()}#ai-trainer`;
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatClockFromIsoText(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(rawHour) || rawHour < 0 || rawHour > 23) return null;
  const suffix = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
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

function formatDistanceMeters(value: number | null | undefined, viewerUnit: DistanceUnit) {
  if (!value || value <= 0) return "—";
  const converted = convertDistanceForDisplay(value / 1000, "KM", viewerUnit);
  if (!converted) return "—";
  return `${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`;
}

function parseExternalRawDateKey(raw: unknown) {
  if (raw && typeof raw === "object") {
    const payload = raw as Record<string, unknown>;
    const localStart = payload.start_date_local;
    if (typeof localStart === "string" && /^\d{4}-\d{2}-\d{2}/.test(localStart)) {
      return localStart.slice(0, 10);
    }
    const utcStart = payload.start_date;
    if (typeof utcStart === "string" && /^\d{4}-\d{2}-\d{2}/.test(utcStart)) {
      return utcStart.slice(0, 10);
    }
  }
  return null;
}

function parseExternalRawTimeLabel(raw: unknown) {
  if (raw && typeof raw === "object") {
    const payload = raw as Record<string, unknown>;
    const localStart = typeof payload.start_date_local === "string" ? payload.start_date_local : null;
    const utcStart = typeof payload.start_date === "string" ? payload.start_date : null;
    return formatClockFromIsoText(localStart) || formatClockFromIsoText(utcStart);
  }
  return null;
}

function getExternalDateKey(raw: unknown, startTime: Date) {
  return parseExternalRawDateKey(raw) || dateKeyUtc(startTime);
}

function parseSyncedSourceDate(notes: string | null | undefined) {
  if (!notes) return null;
  const match = notes.match(/\[Synced from [^\]]* activity (\d{4}-\d{2}-\d{2})\]/i);
  return match?.[1] || null;
}

function stripSyncTagLine(notes: string | null | undefined) {
  if (!notes) return null;
  const next = notes
    .split("\n")
    .filter((line) => !/\[Synced from /i.test(line))
    .join("\n")
    .trim();
  return next || null;
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

  const stravaAccount = await prisma.externalAccount.findFirst({
    where: { userId: user.id, provider: "STRAVA" },
    select: { id: true }
  });

  const params = (await searchParams) || {};
  const requestedPlanId = typeof params.plan === "string" ? params.plan : "";
  const requestedMonth = typeof params.month === "string" ? params.month : undefined;
  const requestedDate = typeof params.date === "string" ? params.date : undefined;
  const requestedReturnTo = typeof params.returnTo === "string" ? params.returnTo : "";
  const returnToDashboard = requestedReturnTo === "dashboard";
  const returnToParam = returnToDashboard ? "dashboard" : null;
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
  const planDisplayName = sourcePlanName || selectedPlan.name;
  const raceName = (selectedPlan.raceName || "").trim()
    || (selectedPlan.raceType ? formatType(selectedPlan.raceType) : "Not set");
  const raceDateStr = selectedPlan.raceDate
    ? new Date(selectedPlan.raceDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Not set";

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
          manualStatus: getDayStatus(day.notes),
          missedReason: getDayMissedReason(day.notes)
        });
      }

      for (const activity of day.activities || []) {
        const next: DatedActivity = {
          id: activity.id,
          title: activity.title || formatType(activity.type),
          type: (activity.type as ActivityType) || "OTHER",
          subtype: activity.subtype ?? null,
          completed: !!activity.completed,
          completedAt: activity.completedAt ?? null,
          distance: activity.distance ?? null,
          duration: activity.duration ?? null,
          distanceUnit: activity.distanceUnit ?? null,
          paceTarget: activity.paceTarget ?? null,
          effortTarget: activity.effortTarget ?? null,
          priority: (activity.priority as "KEY" | "MEDIUM" | "OPTIONAL" | null) ?? null,
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
  const hasSelectedDate = !!parsedRequestedDate;
  const defaultSelectedDate =
    parsedRequestedDate
    || (
      today >= monthStart && today <= monthEnd
        ? today
        : monthStart
    );
  const selectedDateKey = dateKey(defaultSelectedDate);

  const prevMonthHref = buildCalendarHref(addMonths(monthStart, -1), selectedPlan.id, selectedDateKey, returnToParam);
  const nextMonthHref = buildCalendarHref(addMonths(monthStart, 1), selectedPlan.id, selectedDateKey, returnToParam);
  const dashboardReturnHref = returnToDashboard ? `/dashboard?plan=${encodeURIComponent(selectedPlan.id)}` : null;
  const collapseCardHref = dashboardReturnHref ?? buildCalendarHref(monthStart, selectedPlan.id, null, returnToParam);

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
      startTimeLabel: parseExternalRawTimeLabel(item.raw),
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
  const selectedManualStatus = selectedDayInfo?.manualStatus || 'OPEN';
  const selectedDayAutoDone = selectedPlanActivities.length > 0 && selectedPlanActivities.every((activity) => activity.completed);
  const selectedDayStatus: DayStatus = selectedDayAutoDone ? 'DONE' : selectedManualStatus;
  const selectedDayDone = selectedDayStatus === 'DONE';
  const selectedDayMissed = selectedDayStatus === 'MISSED';

  const monthWorkoutCount = dayCells
    .filter((date) => date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear())
    .reduce((sum, date) => sum + (activitiesByDate.get(dateKey(date))?.length || 0), 0);
  const monthCompletedCount = dayCells
    .filter((date) => date.getMonth() === monthStart.getMonth() && date.getFullYear() === monthStart.getFullYear())
    .reduce((sum, date) => sum + (activitiesByDate.get(dateKey(date))?.filter((a) => a.completed).length || 0), 0);
  const monthCompletionPct = monthWorkoutCount > 0
    ? Math.round((monthCompletedCount / monthWorkoutCount) * 100)
    : 0;
  const selectedDayLabel = selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const todayHref = `/dashboard?plan=${encodeURIComponent(selectedPlan.id)}`;
  const adjustThisWeekHref = buildAdjustHref(
    selectedPlan.id,
    "Adjust this week around my schedule, recovery, and available training time."
  );
  return (
    <main className="dash cal-page">
      <SelectedPlanCookie planId={selectedPlan.id} />
      <div className="dash-grid">
        <AthleteSidebar active="calendar" name={name} selectedPlanId={selectedPlan.id} />

        <section className="dash-center">
          <div className="cal-header">
            <div className="dash-page-heading">
              <h1>Training Calendar</h1>
              <p>Month-by-month execution aligned to your active plan.</p>
            </div>
            <div className="cal-header-actions">
              <div className="cal-view-toggle" aria-label="Plan views">
                <Link className="cal-view-pill" href={`/plans/${selectedPlan.id}`}>Plan</Link>
                <span className="cal-view-pill active">Training Calendar</span>
                <Link className="cal-view-pill" href="/strava">Import Strava</Link>
              </div>
            </div>
          </div>

          <div className="dash-card dash-plan-summary">
            <div className="dash-greeting-meta">
              <div className="dash-greeting-meta-item">
                <span className="dash-greeting-meta-label">Plan</span>
                <span className="dash-greeting-meta-value">{planDisplayName}</span>
              </div>
              <div className="dash-greeting-meta-item">
                <span className="dash-greeting-meta-label">Race Name</span>
                <span className="dash-greeting-meta-value">{raceName}</span>
              </div>
              <div className="dash-greeting-meta-item">
                <span className="dash-greeting-meta-label">Race Date</span>
                <span className="dash-greeting-meta-value">{raceDateStr}</span>
              </div>
            </div>
            <a className="dash-greeting-edit-link" href={`/plans/${selectedPlan.id}`}>View Plan</a>
          </div>

          {plans.length > 1 && (
            <div className="dash-card cal-plan-switch">
              <span>Plan:</span>
              <div className="cal-plan-pills">
                {plans.map((plan) => {
                  const href = buildCalendarHref(monthStart, plan.id, selectedDateKey, returnToParam);
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
            <div className="cal-month-nav-row">
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
                const dayManualStatus = dayInfo?.manualStatus || 'OPEN';
                const dayAutoDone = dayActivities.length > 0 && dayActivities.every((activity) => activity.completed);
                const dayStatus: DayStatus = dayAutoDone ? 'DONE' : dayManualStatus;
                const dayDone = dayStatus === 'DONE';
                const dayMissed = dayStatus === 'MISSED';
                const stravaLogs = dayLogs.filter((log) => log.provider === "STRAVA");
                const stravaMarkerLogs = stravaLogs.slice(0, 3);
                const stravaOverflow = Math.max(0, stravaLogs.length - stravaMarkerLogs.length);
                const moreCount = dayActivities.length > 3 ? dayActivities.length - 3 : 0;
                const dayHref = `${buildCalendarHref(monthStart, selectedPlan.id, key, returnToParam)}#day-details-card`;
                return (
                  <div
                    key={key}
                    className={[
                      "cal-day",
                      isOutMonth ? "out-month" : "",
                      isToday ? "today" : "",
                      isSelected ? "selected" : "",
                      dayDone ? "day-done" : "",
                      dayMissed ? "day-missed" : "",
                      inPlan ? "in-plan" : ""
                    ].join(" ").trim()}
                  >
                    <Link className="cal-day-hit" href={dayHref} aria-label={`Open ${key}`} />
                    <div className="cal-day-head">
                      <span className="cal-day-number">{date.getDate()}</span>
                      <div className="cal-day-head-badges">
                        {dayDone && <span className="cal-day-check" title="Day completed">✓</span>}
                        {dayMissed && <span className="cal-day-check missed" title="Day closed as missed">○</span>}
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
                            {activity.completed && <span className="cal-activity-done-dot" />}
                          </span>
                        </div>
                      ))}
                      {moreCount > 0 && (
                        <span className="cal-more">
                          +{moreCount} more
                        </span>
                      )}
                      {stravaLogs.length > 0 ? (
                        <span className="cal-strava-pill">
                          <span className="cal-strava-pill-label">Strava:</span>
                          <span className="cal-strava-pill-icons">
                            {stravaMarkerLogs.map((log) => (
                              <ExternalSportIcon
                                key={log.id}
                                provider={log.provider}
                                sportType={log.sportType}
                                className="cal-strava-icon"
                              />
                            ))}
                            {stravaOverflow > 0 && (
                              <span className="cal-strava-pill-more">+{stravaOverflow}</span>
                            )}
                          </span>
                        </span>
                      ) : dayLogs.length > 0 && (
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
              <span>Abbreviations used in training log cells</span>
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
          {hasSelectedDate && <div id="day-details-card" className="dash-card cal-info-card cal-day-details-card">

            {/* Header: date + status */}
            <div className="cal-detail-header">
              <span className="cal-detail-date">
                {selectedDateKey === dateKey(today) ? "TODAY · " : ""}
                {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
              </span>
              <div className="cal-detail-badges">
                {selectedDayDone && <span className="cal-detail-badge status-done">✓ Done</span>}
                {selectedDayMissed && <span className="cal-detail-badge status-missed">✗ Missed</span>}
              </div>
            </div>


            {/* Planned activities — workout row + log form together, per activity */}
            {selectedPlanActivities.length === 0 && (
              <p className="cal-day-empty">No planned activities on this day.</p>
            )}
            {selectedPlanActivities.map((activity) => {
              const plannedDistanceSource = resolveDistanceUnitFromActivity({
                distanceUnit: activity.distanceUnit,
                paceTarget: activity.paceTarget,
                actualPace: activity.actualPace,
                fallbackUnit: viewerUnits
              });
              const syncedSourceDate = parseSyncedSourceDate(activity.notes);
              const hasSyncedDateMismatch = Boolean(syncedSourceDate && syncedSourceDate !== selectedDateKey);
              const displayDistance = convertDistanceForDisplay(activity.distance, plannedDistanceSource, viewerUnits);
              const displayPaceTarget = convertPaceForDisplay(activity.paceTarget, viewerUnits, plannedDistanceSource) || null;
              const metricParts: string[] = [];
              if (displayDistance) metricParts.push(`${formatDistanceNumber(displayDistance.value)} ${distanceUnitLabel(viewerUnits)}`);
              if (activity.duration) metricParts.push(`${activity.duration} min`);
              if (displayPaceTarget) metricParts.push(`Pace ${displayPaceTarget}`);
              return (
                <div key={activity.id} className="cal-activity-section">
                  <div className="cal-activity-workout-row">
                    <span className={`dash-type-badge dash-type-${activity.type}`}>
                      {ACTIVITY_TYPE_ABBR[activity.type] ?? "OTH"}
                    </span>
                    <div className="cal-activity-workout-info">
                      <span className="cal-activity-title">
                        {activity.title || activity.type}
                        {activity.completed && <span className="cal-activity-done-chip">✓</span>}
                      </span>
                      {metricParts.length > 0 && (
                        <span className="cal-activity-metrics">{metricParts.join(" · ")}</span>
                      )}
                    </div>
                  </div>
                  {hasSyncedDateMismatch && syncedSourceDate && (
                    <p className="cal-day-detail-warning">
                      Synced activity date {syncedSourceDate} does not match this card day.
                    </p>
                  )}
                  <CalendarActivityLogger
                    activity={activity}
                    viewerUnit={viewerUnits}
                    enabled={selectedIsPastOrToday}
                    successRedirectHref={dashboardReturnHref}
                  />
                </div>
              );
            })}

            {/* Logged activities (Strava / external) */}
            {(selectedIsPastOrToday && selectedExternalLogs.length > 0) && (
              <div className="cal-day-detail-section">
                <div className="cal-day-detail-section-header">
                  <h4>Logged Activities</h4>
                  {stravaAccount && <StravaDaySyncButton dateISO={selectedDateKey} className="cal-strava-sync-btn" />}
                </div>
                {selectedExternalLogs.map((log) => (
                  <div key={log.id} className="cal-day-detail-item log">
                    <div className="cal-day-detail-title">
                      <strong className="cal-day-log-title">
                        <ExternalSportIcon
                          provider={log.provider}
                          sportType={log.sportType}
                          className="cal-day-log-icon"
                        />
                        <span>{log.name}</span>
                      </strong>
                      <span>{formatProviderName(log.provider)} · {log.startTimeLabel || formatClock(log.startTime)}</span>
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
            )}

            {/* Day-level close actions */}
            {selectedDayInfo && (
              <DayCompletionButton
                dayId={selectedDayInfo.dayId}
                status={selectedDayStatus}
                missedReason={selectedDayInfo.missedReason}
                successRedirectHref={collapseCardHref}
              />
            )}
            {selectedDayMissed && selectedDayInfo?.missedReason && (
              <p className="cal-day-missed-note">
                Missed reason: {selectedDayInfo.missedReason}
              </p>
            )}

            {/* Empty state: no external logs (past/today only) */}
            {selectedIsPastOrToday && selectedExternalLogs.length === 0 && (
              <div className="cal-day-detail-section">
                <div className="cal-day-detail-section-header">
                  <h4>Logged Activities</h4>
                  {stravaAccount && <StravaDaySyncButton dateISO={selectedDateKey} className="cal-strava-sync-btn" />}
                </div>
                <p className="cal-day-empty">No synced external logs for this day.</p>
              </div>
            )}
            {!selectedIsPastOrToday && (
              <div className="cal-day-detail-section">
                <h4>Logged Activities</h4>
                <p className="cal-day-empty">Future day. Logs will appear after the activity date.</p>
              </div>
            )}
          </div>}

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Quick Actions</span>
            </div>
            {hasSelectedDate && (
              <p className="cal-quick-context">Selected day: {selectedDayLabel}</p>
            )}
            <div className="cal-links">
              <Link href={todayHref}>Go to Today</Link>
              {hasSelectedDate ? (
                <>
                  {selectedIsPastOrToday ? (
                    stravaAccount ? (
                      <StravaDaySyncButton dateISO={selectedDateKey} className="cal-strava-sync-btn" />
                    ) : (
                      <Link href="/strava">Connect Strava to Sync Selected Day</Link>
                    )
                  ) : (
                    <span className="cal-quick-disabled">Sync Selected Day is available on or after that date.</span>
                  )}
                </>
              ) : (
                <span className="cal-quick-disabled">Select a day on the calendar to sync logs.</span>
              )}
              <Link href={adjustThisWeekHref}>Adjust This Week</Link>
            </div>
          </div>

          <div className="dash-card cal-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Selected Plan</span>
            </div>
            <div className="cal-selected-plan-summary">
              <strong>{sourcePlanName || selectedPlan.name}</strong>
              <span>{selectedPlan.raceName || "Race not set"} · {formatDateLabel(selectedPlan.raceDate)}</span>
            </div>
            <details className="cal-selected-plan-details">
              <summary className="cal-selected-plan-toggle">
                <span className="cal-toggle-label-closed">View details</span>
                <span className="cal-toggle-label-open">Hide details</span>
              </summary>
              <div className="cal-selected-plan-details-body">
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
            </details>
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

        </aside>
      </div>
    </main>
  );
}
