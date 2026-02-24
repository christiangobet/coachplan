import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
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
import StravaSyncPanel from "@/components/StravaSyncPanel";
import SelectedPlanCookie from "@/components/SelectedPlanCookie";
import DashboardDayLogShell from "@/components/DashboardDayLogShell";
import { buildLogActivities, buildPlannedMetricParts, type LogActivity } from "@/lib/log-activity";
import DashboardTrainingLogStatus, { type StatusFeedItem } from "@/components/DashboardTrainingLogStatus";
import PlanSummarySection from "@/components/PlanSummarySection";
import type { PlanSummary } from "@/lib/types/plan-summary";
import "./dashboard.css";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DASH_ACTIVITY_LOG_ANCHOR = "#dash-activity-log-card";
const ACTIVITY_TYPE_ABBR: Record<string, string> = {
  RUN: "RUN",
  STRENGTH: "STR",
  CROSS_TRAIN: "XT",
  REST: "RST",
  MOBILITY: "MOB",
  YOGA: "YOG",
  HIKE: "HIK",
  OTHER: "OTH"
};
type DashboardSearchParams = {
  plan?: string;
  activated?: string;
};

function getIsoDay(date: Date) {
  const js = date.getDay();
  return js === 0 ? 7 : js;
}

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatPlannedDate(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function pluralize(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function typeAbbr(type: string | null | undefined) {
  return ACTIVITY_TYPE_ABBR[String(type || "OTHER").toUpperCase()] || "OTH";
}

function toDateKey(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildAiAdjustHref(planId: string, prompt: string) {
  const params = new URLSearchParams();
  params.set("aiPrompt", prompt);
  params.set("aiSource", "dashboard");
  return `/plans/${planId}?${params.toString()}#ai-trainer`;
}



export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const params = (await searchParams) || {};
  const requestedPlanId = typeof params.plan === "string" ? params.plan : "";
  const showActivatedNotice = params.activated === "1";
  const cookieStore = await cookies();
  const cookiePlanId = cookieStore.get(SELECTED_PLAN_COOKIE)?.value || "";

  const name = user.fullName || user.firstName || "Athlete";

  const syncedUser = await ensureUserFromAuth(user, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE"
  });
  const viewerUnits: DistanceUnit = syncedUser.units === "KM" ? "KM" : "MILES";

  const totalPlanCount = await prisma.trainingPlan.count({
    where: { athleteId: user.id, isTemplate: false }
  });
  const latestDraftPlan = await prisma.trainingPlan.findFirst({
    where: { athleteId: user.id, isTemplate: false, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true
    }
  });

  const plans = await prisma.trainingPlan.findMany({
    where: { athleteId: user.id, isTemplate: false, status: "ACTIVE" },
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

  /* ── Empty / onboarding state ── */
  if (totalPlanCount === 0) {
    return (
      <main className="dash">
        <div className="dash-atmosphere" />
        <div className="dash-topo" />
        <div className="dash-empty-content">
          <div className="dash-empty-hero">
            <h1>Welcome, {name}</h1>
            <p>Start your first training cycle in 3 quick steps.</p>
          </div>
          <div className="dash-empty-steps">
            <div className="dash-empty-step">
              <span className="dash-empty-num">01</span>
              <h3>Get a plan in</h3>
              <p>Open Plans Management to upload a PDF or start from a template.</p>
              <div className="dash-empty-actions">
                <Link className="dash-empty-cta" href="/plans">Open Plans Management</Link>
                <Link className="dash-empty-cta-outline" href="/plans">Templates</Link>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">02</span>
              <h3>Review and publish</h3>
              <p>Confirm parsed workouts and activate the plan.</p>
              <div className="dash-empty-actions">
                <Link className="dash-empty-cta-outline" href="/plans">Open Plans Management</Link>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">03</span>
              <h3>Do today’s workout</h3>
              <p>Log actual distance, time, and pace right from dashboard.</p>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">Optional</span>
              <h3>Coach and integrations</h3>
              <p>Connect Strava or invite a coach after your plan is running.</p>
              <div className="dash-empty-actions">
                <Link className="dash-empty-cta-outline" href="/profile">Profile setup</Link>
                <Link className="dash-empty-cta-outline" href="/coach">Coach workspace</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (plans.length === 0) {
    return (
      <main className="dash">
        <div className="dash-atmosphere" />
        <div className="dash-topo" />
        <div className="dash-empty-content">
          <div className="dash-empty-hero">
            <h1>Welcome, {name}</h1>
            <p>Your plan upload is in. Next step: activate one plan to start today guidance.</p>
          </div>
          <div className="dash-empty-steps">
            <div className="dash-empty-step">
              <span className="dash-empty-num">01</span>
              <h3>Review parsed plan</h3>
              <p>
                {latestDraftPlan
                  ? `Open "${latestDraftPlan.name}" and confirm the parse.`
                  : "Open plans and verify your uploaded draft."}
              </p>
              <div className="dash-empty-actions">
                <Link
                  className="dash-empty-cta"
                  href={latestDraftPlan ? `/plans/${latestDraftPlan.id}/review?fromUpload=1` : "/plans"}
                >
                  Open Review
                </Link>
                <Link className="dash-empty-cta-outline" href="/plans">Plans Management</Link>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">02</span>
              <h3>Activate and launch</h3>
              <p>Publish one plan. Today and Training Calendar unlock once a plan is active.</p>
              <div className="dash-empty-actions">
                <Link className="dash-empty-cta-outline" href="/dashboard">Refresh Today</Link>
                <Link className="dash-empty-cta-outline" href="/plans">Go to Plans Management</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ── Active plan data ── */
  const activePlan = pickSelectedPlan(plans, {
    requestedPlanId,
    cookiePlanId
  });

  if (!activePlan) {
    return (
      <main className="dash">
        <div className="dash-atmosphere" />
        <div className="dash-topo" />
        <div className="dash-empty-content">
          <p style={{ color: "var(--d-muted)" }}>No plans available.</p>
        </div>
      </main>
    );
  }

  let sourcePlanName: string | null = null;
  if (activePlan.sourceId) {
    const sourcePlan = await prisma.trainingPlan.findUnique({
      where: { id: activePlan.sourceId },
      select: { name: true }
    });
    sourcePlanName = sourcePlan?.name || null;
  }
  const planDisplayName = sourcePlanName || activePlan.name;
  const stravaAccount = await prisma.externalAccount.findFirst({
    where: { userId: user.id, provider: "STRAVA" },
    select: { id: true }
  });

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const isoDay = getIsoDay(today);
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const raceDateStr = activePlan.raceDate
    ? new Date(activePlan.raceDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Not set";
  const raceName = (activePlan.raceName || "").trim()
    || (activePlan.raceType ? formatType(activePlan.raceType) : "Not set");

  const weeks = [...(activePlan.weeks || [])].sort((a, b) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((w) => w.weekIndex);

  const weekBoundsById = new Map<string, { startDate: Date | null; endDate: Date | null }>();
  for (const week of weeks) {
    const bounds = resolveWeekBounds({
      weekIndex: week.weekIndex,
      weekStartDate: week.startDate,
      weekEndDate: week.endDate,
      raceDate: activePlan.raceDate,
      weekCount: activePlan.weekCount,
      allWeekIndexes
    });
    weekBoundsById.set(week.id, { startDate: bounds.startDate, endDate: bounds.endDate });
  }

  const datedActivities: any[] = [];
  for (const week of weeks) {
    const bounds = weekBoundsById.get(week.id);
    for (const day of week.days || []) {
      const dayDate = getDayDateFromWeekStart(bounds?.startDate || null, day.dayOfWeek);
      if (!dayDate) continue;
      for (const activity of day.activities || []) {
        datedActivities.push({
          ...activity,
          dayOfWeek: day.dayOfWeek,
          weekIndex: week.weekIndex,
          date: dayDate
        });
      }
    }
  }
  datedActivities.sort((a, b) => {
    const dateCmp = a.date.getTime() - b.date.getTime();
    if (dateCmp !== 0) return dateCmp;
    return a.dayOfWeek - b.dayOfWeek;
  });

  const trainingStartDate = datedActivities.length > 0 ? datedActivities[0].date : null;
  const trainingNotStarted = !!(trainingStartDate && today.getTime() < trainingStartDate.getTime());
  const daysUntilTrainingStart = trainingNotStarted && trainingStartDate
    ? Math.ceil((trainingStartDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const weeksUntilTrainingStart = trainingNotStarted ? Math.floor(daysUntilTrainingStart / 7) : 0;

  let currentWeek = weeks.find((w) => {
    const bounds = weekBoundsById.get(w.id);
    const start = bounds?.startDate;
    const end = bounds?.endDate;
    if (!start || !end) return false;
    return today >= start && today <= end;
  });
  if (!currentWeek) {
    const firstBoundedWeek = weeks.find((w) => {
      const bounds = weekBoundsById.get(w.id);
      return !!(bounds?.startDate && bounds?.endDate);
    });
    const lastBoundedWeek = [...weeks].reverse().find((w) => {
      const bounds = weekBoundsById.get(w.id);
      return !!(bounds?.startDate && bounds?.endDate);
    });

    if (firstBoundedWeek && lastBoundedWeek) {
      const firstStart = weekBoundsById.get(firstBoundedWeek.id)?.startDate;
      const lastEnd = weekBoundsById.get(lastBoundedWeek.id)?.endDate;
      if (firstStart && today < firstStart) {
        currentWeek = firstBoundedWeek;
      } else if (lastEnd && today > lastEnd) {
        currentWeek = lastBoundedWeek;
      }
    }

    if (!currentWeek) currentWeek = weeks[0];
  }

  const currentBounds = currentWeek ? weekBoundsById.get(currentWeek.id) : null;
  const isTodayInsideCurrentWeek = !!(
    currentBounds?.startDate &&
    currentBounds?.endDate &&
    today >= currentBounds.startDate &&
    today <= currentBounds.endDate
  );

  const weekDays = [...(currentWeek?.days || [])].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const todayActivities = datedActivities.filter((a) => a.date.getTime() === today.getTime());
  const todayActivity = todayActivities.find((a) => a.type !== "REST") || todayActivities[0] || null;

  /* Upcoming workouts */
  const upcoming = datedActivities
    .filter((a) => a.date.getTime() > today.getTime())
    .slice(0, 3);
  const upcomingHero = upcoming[0] || null;

  /* Week statistics */
  const weekByDay = new Map<number, any>();
  weekDays.forEach((d) => weekByDay.set(d.dayOfWeek, d));

  const allActivities = weekDays.flatMap((d) => d.activities || []);
  const keyActivities = allActivities.filter((a) => a.mustDo || a.priority === "KEY");
  const completedKey = keyActivities.filter((a) => a.completed).length;
  const totalMinutes = allActivities.reduce((acc, a) => acc + (a.duration || 0), 0);

  const recentDayStatuses = isTodayInsideCurrentWeek
    ? weekDays
      .filter((day) => day.dayOfWeek <= isoDay)
      .map((day) => {
        const dayDate = getDayDateFromWeekStart(currentBounds?.startDate || null, day.dayOfWeek);
        const dayLabel = dayDate
          ? dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
          : DAY_LABELS[Math.max(0, (day.dayOfWeek || 1) - 1)];
        const activities = day.activities || [];
        const nonRest = activities.filter((activity: any) => activity.type !== "REST");
        const completedNonRest = nonRest.length > 0 && nonRest.every((activity: any) => activity.completed);
        const isRestOnly = activities.length > 0 && nonRest.length === 0;
        const dayStatus = getDayStatus(day.notes);
        const manualDone = dayStatus === 'DONE';
        const manualMissed = dayStatus === 'MISSED';

        if (manualDone) {
          return {
            alert: false,
            text: `${dayLabel} · Done (manual)`
          };
        }
        if (manualMissed) {
          return {
            alert: false,
            text: `${dayLabel} · Missed (closed)`
          };
        }
        if (completedNonRest || isRestOnly) {
          return {
            alert: false,
            text: `${dayLabel} · Done`
          };
        }
        if (day.dayOfWeek < isoDay) {
          return {
            alert: true,
            text: `${dayLabel} · Pending`,
            logDay: dayDate ? {
              dayId: day.id,
              dateISO: toDateKey(dayDate),
              dateLabel: dayLabel,
              planId: activePlan.id,
              viewerUnits,
              activities: buildLogActivities(activities, viewerUnits),
              initialDayStatus: dayStatus,
              initialMissedReason: getDayMissedReason(day.notes),
              stravaConnected: Boolean(stravaAccount),
            } : undefined,
          };
        }
        return {
          alert: false,
          text: `${dayLabel} · In progress`
        };
      })
      .slice(-5)
    : [];

  /* Status items */
  const statusItems: StatusFeedItem[] = [];
  for (const day of weekDays) {
    const dayStatus = getDayStatus(day.notes);
    if (dayStatus === 'DONE') {
      statusItems.push({
        alert: false,
        text: `${DAY_LABELS[Math.max(0, (day.dayOfWeek || 1) - 1)]} marked done`
      });
      continue;
    }
    if (dayStatus === 'MISSED') {
      statusItems.push({
        alert: false,
        text: `${DAY_LABELS[Math.max(0, (day.dayOfWeek || 1) - 1)]} marked missed`
      });
      continue;
    }
    for (const a of day.activities || []) {
      if (a.completed) {
        statusItems.push({ alert: false, text: `${a.title || a.type} completed` });
      } else if (a.type === "REST") {
        if (isTodayInsideCurrentWeek && day.dayOfWeek < isoDay) {
          statusItems.push({ alert: false, text: "Rest day logged" });
        }
      } else if (isTodayInsideCurrentWeek && day.dayOfWeek < isoDay) {
        statusItems.push({
          alert: true,
          text: `Missed ${a.title || a.type}`,
        });
      }
    }
  }
  const missedKey = isTodayInsideCurrentWeek
    ? keyActivities.filter(
      (a) => {
        const day = weekDays.find((d) => d.activities?.includes(a));
        if (!day) return false;
        const dayStatus = getDayStatus(day.notes);
        if (dayStatus === 'DONE' || dayStatus === 'MISSED') return false;
        return !a.completed && day.dayOfWeek < isoDay;
      }
    )
    : [];
  if (missedKey.length === 0) {
    statusItems.unshift({ alert: false, text: "You're on track" });
  } else {
    statusItems.unshift({ alert: true, text: "Behind on key workouts" });
  }

  /* Plan progress */
  const currentWeekIndex = currentWeek?.weekIndex || 1;
  const totalWeeks = activePlan.weekCount || weeks.length;
  const allPlanActivities = weeks.flatMap((w) =>
    (w.days || []).flatMap((d: any) => d.activities || [])
  );
  const totalActivities = allPlanActivities.length;
  const completedActivities = allPlanActivities.filter((a: any) => a.completed).length;
  const completionPct = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

  const isRestDay = !todayActivity || todayActivity.type === "REST";
  const todayLogDateISO = toDateKey(today);
  const todayLogHref = DASH_ACTIVITY_LOG_ANCHOR;
  const todayDay = isTodayInsideCurrentWeek
    ? (weekDays.find((day) => day.dayOfWeek === isoDay) || null)
    : null;
  const todayDayStatus: DayStatus = todayDay ? getDayStatus(todayDay.notes) : 'OPEN';
  const todayDayMissedReason = todayDay ? getDayMissedReason(todayDay.notes) : null;
  const heroStatusText = todayDayStatus === 'DONE'
    ? 'Day logged'
    : todayDayStatus === 'MISSED'
      ? 'Day closed as missed'
      : 'Ready to log';
  const heroStatusClass = todayDayStatus === 'DONE'
    ? 'dash-hero-top-status dash-hero-top-status--done'
    : todayDayStatus === 'MISSED'
      ? 'dash-hero-top-status dash-hero-top-status--missed'
      : 'dash-hero-top-status dash-hero-top-status--open';
  const logDayCtaLabel = todayDayStatus === 'OPEN' ? 'Log Day' : 'Review Day Log';
  const todayLogActivities = buildLogActivities(todayActivities, viewerUnits);
  const todayPlannedMetricParts = todayActivity
    ? buildPlannedMetricParts(todayActivity, viewerUnits)
    : [];
  const todayMetaLine = todayPlannedMetricParts.join(" · ");
  const upcomingHeroMetricParts = upcomingHero
    ? buildPlannedMetricParts(upcomingHero, viewerUnits)
    : [];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .slice(0, 2)
    .join("") || "CP";
  const weekCompletionPct = allActivities.length > 0
    ? Math.round((allActivities.filter((activity) => activity.completed).length / allActivities.length) * 100)
    : 0;
  const keyCompletionPct = keyActivities.length > 0 ? Math.round((completedKey / keyActivities.length) * 100) : 0;
  const weeklyTimePct = Math.min(100, Math.round((totalMinutes / 420) * 100));
  const statusFeedItems = recentDayStatuses.length > 0 ? recentDayStatuses : statusItems.slice(0, 5);

  return (
    <main className="dash">
      <SelectedPlanCookie planId={activePlan.id} />
      <div className="dash-atmosphere" />
      <div className="dash-topo" />

      <div className="dash-grid">
        <div className="dash-left-col">
          <AthleteSidebar
            active="dashboard"
            name={name}
            sticky={false}
            showQuickActions={false}
            selectedPlanId={activePlan.id}
          />
          <StravaSyncPanel compact />
        </div>

        {/* ── Center ── */}
        <section className="dash-center">
          <div className="dash-page-heading">
            <h1>Today</h1>
            <p>{greeting}, {name} · {dateStr}</p>
          </div>

          {showActivatedNotice && (
            <div className="dash-card dash-activation-banner">
              <strong>Plan activated.</strong>
              <span>Your training schedule is now live. Use Adjust whenever life changes the plan.</span>
            </div>
          )}

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
            <a className="dash-greeting-edit-link" href={`/plans/${activePlan.id}`}>View Plan</a>
          </div>

          {/* Today's workout hero */}
          <div className={`dash-hero${isRestDay ? " dash-hero-rest" : ""}`}>
            {/* Header: date + view plan link */}
            <div className="dash-hero-header">
              <span className="dash-hero-date">TODAY · {dateStr.toUpperCase()}</span>
              <a className="dash-hero-view-plan" href={`/plans/${activePlan.id}`}>View Plan →</a>
            </div>

            {/* Workout info */}
            <div className="dash-hero-workout">
              {todayActivity && (
                <span className={`dash-type-badge dash-type-${todayActivity.type}`}>
                  {typeAbbr(todayActivity.type)}
                </span>
              )}
              <div className="dash-hero-workout-info">
                <h2 className="dash-hero-title">
                  {todayActivity?.title || "Recovery & Rest"}
                </h2>
                {todayPlannedMetricParts.length > 0 && (
                  <p className="dash-hero-metrics">{todayMetaLine}</p>
                )}
                {todayActivity?.rawText && (
                  <p className="dash-hero-desc">{todayActivity.rawText}</p>
                )}
              </div>
            </div>

            {/* Inline log section */}
            <DashboardDayLogShell
              dayId={todayDay?.id || null}
              dateISO={todayLogDateISO}
              planId={activePlan.id}
              viewerUnits={viewerUnits}
              activities={todayLogActivities}
              dayStatus={todayDayStatus}
              missedReason={todayDayMissedReason}
              stravaConnected={Boolean(stravaAccount)}
            />
          </div>

          {/* Upcoming workouts */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Next Up</span>
              <a className="dash-card-link" href={`/plans/${activePlan.id}`}>
                View plan
              </a>
            </div>
            {trainingNotStarted && trainingStartDate && (
              <div className="dash-upcoming-start">
                <span className="dash-upcoming-start-label">
                  Training starts {trainingStartDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <div className="dash-upcoming-start-metrics">
                  <span className="dash-upcoming-start-chip">
                    {pluralize(weeksUntilTrainingStart, "week", "weeks")}
                  </span>
                  <span className="dash-upcoming-start-chip">
                    {pluralize(daysUntilTrainingStart, "day", "days")}
                  </span>
                </div>
              </div>
            )}
            {upcoming.length === 0 && (
              <p style={{ color: "var(--d-muted)", fontSize: 14 }}>
                No upcoming workouts scheduled after today.
              </p>
            )}

            {upcoming.length > 0 && (
              <>
                {/* Hero Item */}
                <div className={`dash-next-hero type-${(upcomingHero?.type || 'OTHER').toLowerCase()}`}>
                  <div className="dash-next-hero-top">
                    <span className="dash-next-hero-label">
                      {upcomingHero && (getIsoDay(upcomingHero.date) - getIsoDay(today) === 1
                        ? 'Tomorrow'
                        : formatPlannedDate(upcomingHero.date))}
                    </span>
                    {upcomingHeroMetricParts.length > 0 && (
                      <span className="dash-next-hero-date">
                        {upcomingHeroMetricParts.join(" · ")}
                      </span>
                    )}
                  </div>
                  <div className="dash-next-hero-title">
                    {upcomingHero?.title}
                  </div>
                  <div className="dash-next-hero-meta">
                    <span
                      className={`dash-type-pill type-${String(upcomingHero?.type || "OTHER").toLowerCase()}`}
                      title={formatType(upcomingHero?.type || 'OTHER')}
                    >
                      {typeAbbr(upcomingHero?.type || 'OTHER')}
                    </span>
                  </div>
                  {upcomingHero?.notes && (
                    <div className="dash-next-hero-notes">
                      {upcomingHero.notes}
                    </div>
                  )}
                </div>

                {/* Remaining List */}
                {upcoming.slice(1).map((a) => {
                  const metricParts = buildPlannedMetricParts(a, viewerUnits);
                  return (
                    <div className="dash-upcoming-item" key={a.id}>
                      <div className="dash-upcoming-left">
                        <div className="dash-upcoming-day">
                          {a.date ? DAY_LABELS[getIsoDay(a.date) - 1] : DAY_LABELS[(a.dayOfWeek || 1) - 1]}
                        </div>
                        <div className="dash-upcoming-info">
                          <span className="dash-upcoming-title">
                            {a.title}
                          </span>
                          <span className="dash-upcoming-type" title={formatType(a.type)}>
                            {typeAbbr(a.type)}
                          </span>
                          <span className="dash-upcoming-date">{formatPlannedDate(a.date)}</span>
                        </div>
                      </div>
                      {metricParts.length > 0 && (
                        <span className="dash-upcoming-metrics">
                          {metricParts.join(" · ")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Guide */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">📋 Plan Reference</span>
              <a className="dash-card-link" href={`/plans/${activePlan.id}`}>Full guide →</a>
            </div>
            <PlanSummarySection
              summary={activePlan.planSummary as PlanSummary | null}
              planId={activePlan.id}
            />
          </div>
        </section>

        {/* ── Right sidebar ── */}
        <aside className="dash-right">
          <div className="dash-card dash-profile-card">
            <div className="dash-profile-top">
              <div className="dash-profile-avatar">{initials}</div>
              <div>
                <h3>{name}</h3>
                <p>Runner · CoachPlan</p>
              </div>
            </div>
            <div className="dash-profile-stats">
              <div>
                <strong>{totalPlanCount}</strong>
                <span>Plans</span>
              </div>
              <div>
                <strong>{totalActivities}</strong>
                <span>Workouts</span>
              </div>
              <div>
                <strong>{completedActivities}</strong>
                <span>Done</span>
              </div>
            </div>
          </div>

          {/* Status feed */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Training Calendar Status</span>
            </div>
            <DashboardTrainingLogStatus items={statusFeedItems} />
          </div>

          <div className="dash-card dash-week-snapshot">
            <div className="dash-card-header">
              <span className="dash-card-title">This Week</span>
              <span className="dash-week-snapshot-range">Week {currentWeekIndex}</span>
            </div>
            <div className="dash-week-snapshot-row">
              <span>Workouts</span>
              <strong>{weekCompletionPct}%</strong>
            </div>
            <div className="dash-week-snapshot-bar">
              <div style={{ width: `${weekCompletionPct}%` }} />
            </div>
            <div className="dash-week-snapshot-row">
              <span>Key sessions</span>
              <strong>{keyCompletionPct}%</strong>
            </div>
            <div className="dash-week-snapshot-bar key">
              <div style={{ width: `${keyCompletionPct}%` }} />
            </div>
            <div className="dash-week-snapshot-row">
              <span>Time logged</span>
              <strong>{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</strong>
            </div>
            <div className="dash-week-snapshot-bar time">
              <div style={{ width: `${weeklyTimePct}%` }} />
            </div>
          </div>

          {/* Weekly overview */}
          <div className="dash-card">
            <details className="dash-collapse">
              <summary className="dash-collapse-summary">
                <span className="dash-card-title">This Week</span>
                <span style={{ fontSize: 12, color: "var(--d-muted)" }}>
                  Week {currentWeekIndex}
                </span>
              </summary>
              <div className="dash-collapse-body">
                <div className="dash-week-strip">
                  {DAY_LABELS.map((label, idx) => {
                    const day = idx + 1;
                    const dayEntry = weekByDay.get(day);
                    const hasActivities = dayEntry?.activities?.length > 0;
                    const dayStatus = getDayStatus(dayEntry?.notes);
                    const manualDone = dayStatus === 'DONE';
                    const manualMissed = dayStatus === 'MISSED';
                    const allDone = manualDone || (hasActivities && dayEntry.activities.every((a: any) => a.completed));
                    const isToday = isTodayInsideCurrentWeek && day === isoDay;
                    const isMissed = manualMissed || (isTodayInsideCurrentWeek && hasActivities && !allDone && day < isoDay);

                    let dotClass = "dash-week-dot";
                    let dotContent = "";
                    if (allDone) { dotClass += " done"; dotContent = "\u2713"; }
                    else if (isToday) { dotClass += " today"; dotContent = "\u2022"; }
                    else if (isMissed) { dotClass += " missed"; dotContent = "\u2715"; }

                    return (
                      <div className="dash-week-day" key={label}>
                        <span className="dash-week-label">{label[0]}</span>
                        <span className={dotClass}>{dotContent}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="dash-week-stats">
                  <div className="dash-week-stat">
                    <div className="dash-week-stat-value">
                      {completedKey}/{keyActivities.length}
                    </div>
                    <div className="dash-week-stat-label">Key Workouts</div>
                  </div>
                  <div className="dash-week-stat">
                    <div className="dash-week-stat-value">
                      {Math.floor(totalMinutes / 60)}h{totalMinutes % 60 > 0 ? ` ${totalMinutes % 60}m` : ""}
                    </div>
                    <div className="dash-week-stat-label">Total Time</div>
                  </div>
                </div>
              </div>
            </details>
          </div>

          {/* Plan progress */}
          <div className="dash-card">
            <details className="dash-collapse">
              <summary className="dash-collapse-summary">
                <span className="dash-card-title">Plan Progress</span>
                <span style={{ fontSize: 12, color: "var(--d-muted)" }}>
                  {completionPct}%
                </span>
              </summary>
              <div className="dash-collapse-body">
                <div className="dash-progress-big">
                  <div className="dash-progress-pct">
                    {completionPct}<span className="dash-progress-sign">%</span>
                  </div>
                  <div className="dash-progress-sub">
                    {completedActivities} of {totalActivities} workouts
                  </div>
                </div>
                <div className="dash-progress-bar">
                  <div className="dash-progress-fill" style={{ width: `${completionPct}%` }} />
                </div>
                <div className="dash-progress-details">
                  <span>Week <strong>{currentWeekIndex}</strong> of <strong>{totalWeeks}</strong></span>
                  <span><strong>{completedActivities}</strong> / {totalActivities}</span>
                </div>
                <a className="dash-view-plan" href={`/plans/${activePlan.id}`}>
                  View Full Plan &rarr;
                </a>
              </div>
            </details>
          </div>
        </aside>
      </div>
    </main>
  );
}
