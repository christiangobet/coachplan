import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { getDayDateFromWeekStart, resolveWeekBounds } from "@/lib/plan-dates";
import { isDayMarkedDone } from "@/lib/day-status";
import { pickSelectedPlan, SELECTED_PLAN_COOKIE } from "@/lib/plan-selection";
import {
  convertDistanceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  type DistanceUnit
} from "@/lib/unit-display";
import AthleteSidebar from "@/components/AthleteSidebar";
import SelectedPlanCookie from "@/components/SelectedPlanCookie";
import "../dashboard/dashboard.css";
import "./progress.css";

type ProgressSearchParams = {
  plan?: string;
  window?: string;
};

type WindowKey = "7d" | "28d" | "plan";

const WINDOW_OPTIONS: Array<{ key: WindowKey; label: string }> = [
  { key: "7d", label: "Last 7 days" },
  { key: "28d", label: "Last 28 days" },
  { key: "plan", label: "Plan to date" }
];

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatDateLabel(value: Date | null | undefined) {
  if (!value) return "Not set";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dateKey(value: Date) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDurationTotal(minutes: number) {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function toWindowKey(raw: string | undefined): WindowKey {
  if (raw === "7d" || raw === "28d" || raw === "plan") return raw;
  return "28d";
}

function buildProgressHref(planId: string, window: WindowKey) {
  const params = new URLSearchParams();
  params.set("plan", planId);
  params.set("window", window);
  return `/progress?${params.toString()}`;
}

function buildWindowRange(today: Date, planStart: Date | null, key: WindowKey) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  if (key === "7d") {
    start.setDate(start.getDate() - 6);
    return start;
  }
  if (key === "28d") {
    start.setDate(start.getDate() - 27);
    return start;
  }
  if (planStart) {
    const normalizedPlanStart = new Date(planStart);
    normalizedPlanStart.setHours(0, 0, 0, 0);
    return normalizedPlanStart <= today ? normalizedPlanStart : start;
  }
  start.setDate(start.getDate() - 27);
  return start;
}

export default async function ProgressPage({
  searchParams
}: {
  searchParams?: Promise<ProgressSearchParams>;
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
  const windowKey = toWindowKey(typeof params.window === "string" ? params.window : undefined);
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

  const weeks = [...selectedPlan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((w) => w.weekIndex);

  const dayRows: Array<{
    dayId: string;
    weekId: string;
    weekIndex: number;
    date: Date;
    manualDone: boolean;
    activities: typeof selectedPlan.weeks[number]["days"][number]["activities"];
  }> = [];

  const weekBoundsById = new Map<string, { startDate: Date | null; endDate: Date | null }>();
  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: selectedPlan.raceDate,
      weekCount: selectedPlan.weekCount,
      allWeekIndexes
    });
    weekBoundsById.set(week.id, { startDate: bounds.startDate, endDate: bounds.endDate });

    for (const day of week.days || []) {
      const dayDate = getDayDateFromWeekStart(bounds.startDate, day.dayOfWeek);
      if (!dayDate) continue;
      dayRows.push({
        dayId: day.id,
        weekId: week.id,
        weekIndex: week.weekIndex,
        date: dayDate,
        manualDone: isDayMarkedDone(day.notes),
        activities: day.activities || []
      });
    }
  }
  dayRows.sort((a, b) => a.date.getTime() - b.date.getTime());

  const planStartDate = dayRows[0]?.date || null;
  const planEndDate = dayRows[dayRows.length - 1]?.date || null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = buildWindowRange(today, planStartDate, windowKey);
  const windowEnd = new Date(today);
  windowEnd.setHours(23, 59, 59, 999);

  const dayRowsInWindow = dayRows.filter((row) => row.date >= windowStart && row.date <= today);
  const scheduledDaysInWindow = dayRowsInWindow.filter((row) => row.activities.length > 0);

  const dayStatusRows = scheduledDaysInWindow.map((row) => {
    const allCompleted = row.activities.length > 0 && row.activities.every((activity) => activity.completed);
    const done = row.manualDone || allCompleted;
    return {
      ...row,
      done
    };
  });

  const dueActivities = dayStatusRows.flatMap((row) => row.activities);
  const totalWorkouts = dueActivities.length;
  const completedWorkouts = dueActivities.filter((activity) => activity.completed).length;
  const completionRate = percent(completedWorkouts, totalWorkouts);

  const keyWorkouts = dueActivities.filter((activity) => activity.mustDo || activity.priority === "KEY");
  const keyCompleted = keyWorkouts.filter((activity) => activity.completed).length;
  const keyRate = percent(keyCompleted, keyWorkouts.length);

  const completedDays = dayStatusRows.filter((row) => row.done).length;
  const dayCompletionRate = percent(completedDays, dayStatusRows.length);
  const missedDays = dayStatusRows.filter((row) => row.date < today && !row.done).length;

  let currentStreak = 0;
  const sortedDaysDesc = [...dayStatusRows].sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const row of sortedDaysDesc) {
    if (row.done) currentStreak += 1;
    else break;
  }

  const distanceUnitText = distanceUnitLabel(viewerUnits);
  let plannedDistance = 0;
  let actualDistance = 0;
  let plannedMinutes = 0;
  let actualMinutes = 0;
  const byType = new Map<string, {
    type: string;
    planned: number;
    completed: number;
    plannedDistance: number;
    actualDistance: number;
  }>();

  for (const activity of dueActivities) {
    if (activity.duration && activity.duration > 0) plannedMinutes += activity.duration;
    if (activity.actualDuration && activity.actualDuration > 0) actualMinutes += activity.actualDuration;

    const plannedDist = convertDistanceForDisplay(
      activity.distance ?? null,
      activity.distanceUnit ?? null,
      viewerUnits
    )?.value || 0;
    const actualDist = convertDistanceForDisplay(
      activity.actualDistance ?? null,
      activity.distanceUnit ?? null,
      viewerUnits
    )?.value || 0;
    plannedDistance += plannedDist;
    actualDistance += actualDist;

    const key = activity.type;
    const current = byType.get(key) || {
      type: key,
      planned: 0,
      completed: 0,
      plannedDistance: 0,
      actualDistance: 0
    };
    current.planned += 1;
    if (activity.completed) current.completed += 1;
    current.plannedDistance += plannedDist;
    current.actualDistance += actualDist;
    byType.set(key, current);
  }

  const distanceAdherence = plannedDistance > 0 ? Math.round((actualDistance / plannedDistance) * 100) : 0;
  const timeAdherence = plannedMinutes > 0 ? Math.round((actualMinutes / plannedMinutes) * 100) : 0;

  const weekTrend = weeks.map((week) => {
    const rows = dayStatusRows.filter((row) => row.weekId === week.id);
    const activities = rows.flatMap((row) => row.activities);
    const total = activities.length;
    const completed = activities.filter((activity) => activity.completed).length;
    const doneDays = rows.filter((row) => row.done).length;

    let weekPlannedDistance = 0;
    let weekActualDistance = 0;
    for (const activity of activities) {
      weekPlannedDistance += convertDistanceForDisplay(
        activity.distance ?? null,
        activity.distanceUnit ?? null,
        viewerUnits
      )?.value || 0;
      weekActualDistance += convertDistanceForDisplay(
        activity.actualDistance ?? null,
        activity.distanceUnit ?? null,
        viewerUnits
      )?.value || 0;
    }

    return {
      id: week.id,
      weekIndex: week.weekIndex,
      total,
      completed,
      doneDays,
      activeDays: rows.length,
      percent: percent(completed, total),
      plannedDistance: weekPlannedDistance,
      actualDistance: weekActualDistance
    };
  });

  const recentWeeks = weekTrend.filter((week) => week.total > 0).slice(Math.max(0, weekTrend.length - 8));
  const bestWeek = recentWeeks.reduce(
    (best, week) => (week.percent > best.percent ? week : best),
    { id: "none", weekIndex: 0, total: 0, completed: 0, doneDays: 0, activeDays: 0, percent: 0, plannedDistance: 0, actualDistance: 0 }
  );

  const typeRows = [...byType.values()]
    .sort((a, b) => b.planned - a.planned)
    .map((row) => ({
      ...row,
      completion: percent(row.completed, row.planned)
    }));

  const dayStatusByKey = new Map<string, "done" | "missed" | "today" | "none">();
  for (const row of dayStatusRows) {
    const key = dateKey(row.date);
    if (row.done) dayStatusByKey.set(key, "done");
    else if (row.date < today) dayStatusByKey.set(key, "missed");
    else if (row.date.getTime() === today.getTime()) dayStatusByKey.set(key, "today");
    else dayStatusByKey.set(key, "none");
  }

  const heatStart = new Date(today);
  heatStart.setDate(heatStart.getDate() - 55);
  const heatDays: Array<{ key: string; date: Date; state: "done" | "missed" | "today" | "none" }> = [];
  for (let i = 0; i < 56; i += 1) {
    const d = new Date(heatStart);
    d.setDate(heatStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const key = dateKey(d);
    heatDays.push({
      key,
      date: d,
      state: dayStatusByKey.get(key) || (d.getTime() === today.getTime() ? "today" : "none")
    });
  }
  const heatWeeks = Array.from({ length: 8 }, (_, idx) => heatDays.slice(idx * 7, (idx + 1) * 7));

  const stravaAccount = await prisma.externalAccount.findUnique({
    where: {
      userId_provider: {
        userId: user.id,
        provider: IntegrationProvider.STRAVA
      }
    },
    select: {
      isActive: true,
      providerUsername: true,
      lastSyncAt: true
    }
  });

  const [stravaWindowCount, stravaMatchedCount] = await Promise.all([
    prisma.externalActivity.count({
      where: {
        userId: user.id,
        provider: IntegrationProvider.STRAVA,
        startTime: {
          gte: windowStart,
          lte: windowEnd
        }
      }
    }),
    prisma.externalActivity.count({
      where: {
        userId: user.id,
        provider: IntegrationProvider.STRAVA,
        startTime: {
          gte: windowStart,
          lte: windowEnd
        },
        matchedPlanActivityId: { not: null }
      }
    })
  ]);

  const stravaUnmatched = Math.max(0, stravaWindowCount - stravaMatchedCount);
  const stravaMatchRate = percent(stravaMatchedCount, stravaWindowCount);

  return (
    <main className="dash prog-page-shell">
      <SelectedPlanCookie planId={selectedPlan.id} />
      <div className="dash-grid">
        <AthleteSidebar active="progress" name={name} selectedPlanId={selectedPlan.id} />

        <section className="dash-center">
          <div className="dash-card prog-header-card">
            <h1>Progress</h1>
            <p>Execution analytics for <strong>{planDisplayName}</strong> in the selected window.</p>
          </div>

          <div className="dash-card prog-filter-card">
            <div className="prog-filter-block">
              <strong>Plan</strong>
              <div className="prog-filter-chips">
                {plans.map((plan) => {
                  const active = plan.id === selectedPlan.id;
                  return (
                    <Link
                      key={plan.id}
                      href={buildProgressHref(plan.id, windowKey)}
                      className={active ? "prog-chip active" : "prog-chip"}
                    >
                      {plan.name}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="prog-filter-block">
              <strong>Window</strong>
              <div className="prog-filter-chips">
                {WINDOW_OPTIONS.map((option) => (
                  <Link
                    key={option.key}
                    href={buildProgressHref(selectedPlan.id, option.key)}
                    className={windowKey === option.key ? "prog-chip active" : "prog-chip"}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="prog-metric-grid">
            <article className="dash-card prog-metric-card">
              <h2>Workout Completion</h2>
              <div className="prog-big">{completionRate}%</div>
              <p>{completedWorkouts} of {totalWorkouts} workouts done</p>
            </article>
            <article className="dash-card prog-metric-card">
              <h2>Day Completion</h2>
              <div className="prog-big">{dayCompletionRate}%</div>
              <p>{completedDays} of {dayStatusRows.length} scheduled days done</p>
            </article>
            <article className="dash-card prog-metric-card">
              <h2>Key Sessions</h2>
              <div className="prog-big">{keyRate}%</div>
              <p>{keyCompleted} of {keyWorkouts.length} key workouts done</p>
            </article>
            <article className="dash-card prog-metric-card">
              <h2>Current Streak</h2>
              <div className="prog-big">{currentStreak}</div>
              <p>{currentStreak === 1 ? "scheduled day" : "scheduled days"} in a row</p>
            </article>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Planned vs Actual</span>
            </div>
            <div className="prog-volume-grid">
              <div className="prog-volume-item">
                <strong>Distance</strong>
                <span>
                  {formatDistanceNumber(actualDistance)} / {formatDistanceNumber(plannedDistance)} {distanceUnitText}
                </span>
                <em>{distanceAdherence}% adherence</em>
              </div>
              <div className="prog-volume-item">
                <strong>Duration</strong>
                <span>{formatDurationTotal(actualMinutes)} / {formatDurationTotal(plannedMinutes)}</span>
                <em>{timeAdherence}% adherence</em>
              </div>
              <div className="prog-volume-item">
                <strong>Missed days</strong>
                <span>{missedDays}</span>
                <em>Scheduled days not completed</em>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Weekly Trend</span>
            </div>
            <div className="prog-trend-list">
              {recentWeeks.length === 0 && <p className="prog-muted">No week data in this window yet.</p>}
              {recentWeeks.map((week) => (
                <div className="prog-week-row" key={week.id}>
                  <span className="prog-week-label">Week {week.weekIndex}</span>
                  <div className="prog-week-bar">
                    <div className="prog-week-fill" style={{ width: `${week.percent}%` }} />
                  </div>
                  <span className="prog-week-pct">{week.percent}%</span>
                  <span className="prog-week-meta">
                    {week.completed}/{week.total} · {formatDistanceNumber(week.actualDistance)}/{formatDistanceNumber(week.plannedDistance)} {distanceUnitText}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">By Workout Type</span>
            </div>
            <div className="prog-type-grid">
              {typeRows.length === 0 && <p className="prog-muted">No workout records in this window.</p>}
              {typeRows.map((row) => (
                <div key={row.type} className="prog-type-row">
                  <strong>{formatType(row.type)}</strong>
                  <span>{row.completed}/{row.planned} completed ({row.completion}%)</span>
                  <span>
                    {formatDistanceNumber(row.actualDistance)}/{formatDistanceNumber(row.plannedDistance)} {distanceUnitText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="dash-right">
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Scope</span>
            </div>
            <div className="prog-highlight-list">
              <div>
                <strong>Plan</strong>
                <span>{planDisplayName}</span>
              </div>
              <div>
                <strong>Race</strong>
                <span>{selectedPlan.raceName || "Not set"}</span>
              </div>
              <div>
                <strong>Training window</strong>
                <span>{formatDateLabel(planStartDate)} - {formatDateLabel(planEndDate)}</span>
              </div>
              <div>
                <strong>Analysis range</strong>
                <span>{formatDateLabel(windowStart)} - {formatDateLabel(today)}</span>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Consistency Heatmap</span>
            </div>
            <div className="prog-heatmap">
              {heatWeeks.map((week, idx) => (
                <div key={idx} className="prog-heatmap-week">
                  {week.map((day) => (
                    <span
                      key={day.key}
                      className={`prog-heat ${day.state}`}
                      title={`${formatDateLabel(day.date)} · ${day.state}`}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="prog-heatmap-legend">
              <span><i className="prog-heat done" /> Done</span>
              <span><i className="prog-heat missed" /> Missed</span>
              <span><i className="prog-heat today" /> Today</span>
              <span><i className="prog-heat none" /> No workout</span>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Strava Data Quality</span>
            </div>
            <div className="prog-highlight-list">
              <div>
                <strong>Status</strong>
                <span>
                  {stravaAccount?.isActive
                    ? `Connected${stravaAccount.providerUsername ? ` as ${stravaAccount.providerUsername}` : ""}`
                    : "Not connected"}
                </span>
              </div>
              <div>
                <strong>Last sync</strong>
                <span>{formatDateLabel(stravaAccount?.lastSyncAt || null)}</span>
              </div>
              <div>
                <strong>Window activities</strong>
                <span>{stravaWindowCount}</span>
              </div>
              <div>
                <strong>Matched to plan</strong>
                <span>{stravaMatchedCount} ({stravaMatchRate}%)</span>
              </div>
              <div>
                <strong>Unmatched</strong>
                <span>{stravaUnmatched}</span>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Highlights</span>
            </div>
            <div className="prog-highlight-list">
              <div>
                <strong>Best week</strong>
                <span>
                  Week {bestWeek.weekIndex > 0 ? bestWeek.weekIndex : "—"} at {bestWeek.percent}%
                </span>
              </div>
              <div>
                <strong>Window mode</strong>
                <span>{WINDOW_OPTIONS.find((option) => option.key === windowKey)?.label || "Custom"}</span>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="prog-actions">
              <Link href="/dashboard">Open dashboard</Link>
              <Link href={`/plans/${selectedPlan.id}`}>Open plan calendar</Link>
              <Link href="/calendar">Review calendar</Link>
              <Link href="/profile">Manage profile & units</Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
