import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getDayDateFromWeekStart, resolveWeekBounds } from "@/lib/plan-dates";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { isDayMarkedDone } from "@/lib/day-status";
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  type DistanceUnit
} from "@/lib/unit-display";
import CompleteWorkoutButton from "@/components/CompleteWorkoutButton";
import AthleteSidebar from "@/components/AthleteSidebar";
import StravaSyncPanel from "@/components/StravaSyncPanel";
import StravaActivityMatchTable from "@/components/StravaActivityMatchTable";
import "./dashboard.css";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getIsoDay(date: Date) {
  const js = date.getDay();
  return js === 0 ? 7 : js;
}

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatTypeCode(type: string) {
  const t = (type || "").toUpperCase();
  if (t === "RUN") return "RN";
  if (t === "STRENGTH") return "ST";
  if (t === "CROSS_TRAIN") return "XT";
  if (t === "REST") return "RS";
  if (t === "YOGA") return "YG";
  if (t === "MOBILITY") return "MB";
  if (t === "HIKE") return "HK";
  return "OT";
}

function formatPlannedDate(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function pluralize(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const name = user.fullName || user.firstName || "Athlete";

  const syncedUser = await ensureUserFromAuth(user, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE"
  });
  const viewerUnits: DistanceUnit = syncedUser.units === "KM" ? "KM" : "MILES";

  const totalPlanCount = await prisma.trainingPlan.count({
    where: { athleteId: user.id, isTemplate: false }
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
              <p>Upload a PDF or start from a template.</p>
              <div className="dash-empty-actions">
                <a className="dash-empty-cta" href="/upload">Upload PDF</a>
                <a className="dash-empty-cta-outline" href="/plans">Templates</a>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">02</span>
              <h3>Review and publish</h3>
              <p>Confirm parsed workouts and activate the plan.</p>
              <div className="dash-empty-actions">
                <a className="dash-empty-cta-outline" href="/plans">Open plans</a>
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
                <a className="dash-empty-cta-outline" href="/profile">Profile setup</a>
                <a className="dash-empty-cta-outline" href="/coach">Coach workspace</a>
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
            <p>You have plans, but none are active yet.</p>
          </div>
          <div className="dash-empty-steps">
            <div className="dash-empty-step">
              <span className="dash-empty-num">01</span>
              <h3>Activate a plan</h3>
              <p>Open plan management and set one draft plan to Active.</p>
              <div className="dash-empty-actions">
                <a className="dash-empty-cta" href="/plans">Manage Plans</a>
                <a className="dash-empty-cta-outline" href="/upload">Upload Plan</a>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ── Active plan data ── */
  const activePlan = plans[0];

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
          const manualDone = isDayMarkedDone(day.notes);
          const dayDate = getDayDateFromWeekStart(currentBounds?.startDate || null, day.dayOfWeek);
          const dayLabel = dayDate
            ? dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
            : DAY_LABELS[Math.max(0, (day.dayOfWeek || 1) - 1)];
          const activities = day.activities || [];
          const nonRest = activities.filter((activity: any) => activity.type !== "REST");
          const completedNonRest = nonRest.length > 0 && nonRest.every((activity: any) => activity.completed);
          const isRestOnly = activities.length > 0 && nonRest.length === 0;

          if (manualDone) {
            return {
              alert: false,
              text: `${dayLabel} · Done (manual)`
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
              text: `${dayLabel} · Pending`
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
  const statusItems: { alert: boolean; text: string }[] = [];
  for (const day of weekDays) {
    if (isDayMarkedDone(day.notes)) {
      statusItems.push({
        alert: false,
        text: `${DAY_LABELS[Math.max(0, (day.dayOfWeek || 1) - 1)]} marked done`
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
        statusItems.push({ alert: true, text: `Missed ${a.title || a.type}` });
      }
    }
  }
  const missedKey = isTodayInsideCurrentWeek
    ? keyActivities.filter(
        (a) => {
          const day = weekDays.find((d) => d.activities?.includes(a));
          if (!day) return false;
          if (isDayMarkedDone(day.notes)) return false;
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
  const todayDisplayDistance = todayActivity
    ? convertDistanceForDisplay(todayActivity.distance, todayActivity.distanceUnit, viewerUnits)
    : null;
  const todayDisplayActualDistance = todayActivity
    ? convertDistanceForDisplay(todayActivity.actualDistance, todayActivity.distanceUnit, viewerUnits)
    : null;
  const todayDisplayActualPace = todayActivity
    ? convertPaceForDisplay(todayActivity.actualPace, viewerUnits, todayActivity.distanceUnit || viewerUnits)
    : null;

  return (
    <main className="dash">
      <div className="dash-atmosphere" />
      <div className="dash-topo" />

      <div className="dash-grid">
        <div className="dash-left-col">
          <AthleteSidebar active="today" name={name} sticky={false} showQuickActions={false} />
          <StravaSyncPanel compact />
        </div>

        {/* ── Center ── */}
        <section className="dash-center">
          <div className="dash-greeting">
            <h1>{greeting}, {name}</h1>
            <div className="dash-greeting-date">{dateStr}</div>
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
            <a className="dash-greeting-edit-link" href={`/plans/${activePlan.id}`}>Edit race info</a>
          </div>

          {/* Today's workout hero */}
          <div className={`dash-hero${isRestDay ? " dash-hero-rest" : ""}`}>
            <div className="dash-hero-label">TODAY · {dateStr}</div>
            {todayActivity && (
              <span className={`dash-type-badge dash-type-${todayActivity.type}`}>
                {formatType(todayActivity.type)}
              </span>
            )}
            <h2 className="dash-hero-title">
              {todayActivity?.title || "Recovery & Rest"}
            </h2>
            <div className="dash-hero-meta">
              <span>{formatPlannedDate(today)}</span>
              {todayActivity?.duration && (
                <>
                  <span className="dash-hero-sep" />
                  <span>{todayActivity.duration} min</span>
                </>
              )}
              {todayActivity?.duration && todayActivity?.distance && (
                <span className="dash-hero-sep" />
              )}
              {todayDisplayDistance && (
                <span>{formatDistanceNumber(todayDisplayDistance.value)} {distanceUnitLabel(todayDisplayDistance.unit)}</span>
              )}
              {!todayActivity?.duration && !todayActivity?.distance && (
                <span>{todayActivity ? "Follow plan notes" : "No workout scheduled on today's plan date"}</span>
              )}
            </div>
            {todayActivity?.rawText && (
              <div className="dash-hero-detail">{todayActivity.rawText}</div>
            )}
            <div className="dash-hero-actions">
              {todayActivity ? (
                <>
                  <CompleteWorkoutButton
                    activityId={todayActivity.id}
                    completed={todayActivity.completed}
                    actualDistance={todayDisplayActualDistance?.value ?? null}
                    actualDuration={todayActivity.actualDuration}
                    actualPace={todayDisplayActualPace}
                    plannedDistance={todayDisplayDistance?.value ?? null}
                    plannedDuration={todayActivity.duration}
                    distanceUnit={viewerUnits}
                  />
                  <a className="dash-btn-secondary" href={`/plans/${activePlan.id}`}>
                    View Plan
                  </a>
                </>
              ) : (
                <a className="dash-btn-secondary" href={`/plans/${activePlan.id}`}>
                  View Plan
                </a>
              )}
            </div>
          </div>

          <StravaActivityMatchTable />

          {/* Upcoming workouts */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Next Up</span>
              <a className="dash-card-link" href={`/plans/${activePlan.id}`}>
                Full plan
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
            {upcoming.map((a) => (
              <div className="dash-upcoming-item" key={a.id}>
                <div className="dash-upcoming-left">
                  <div className="dash-upcoming-day">
                    {a.date ? DAY_LABELS[getIsoDay(a.date) - 1] : DAY_LABELS[(a.dayOfWeek || 1) - 1]}
                  </div>
                  <div className="dash-upcoming-info">
                    <span className="dash-upcoming-title">
                      <span className={`dash-type-icon type-${String(a.type || "OTHER").toLowerCase()}`}>
                        {formatTypeCode(String(a.type || "OTHER"))}
                      </span>
                      {a.title}
                    </span>
                    <span className="dash-upcoming-type">{formatType(a.type)}</span>
                    <span className="dash-upcoming-date">{formatPlannedDate(a.date)}</span>
                  </div>
                </div>
                <span className="dash-upcoming-duration">
                  {a.duration ? `${a.duration} min` : "—"}
                </span>
              </div>
            ))}
          </div>

          {/* Guide */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Guide</span>
            </div>
            <a className="dash-guide-item" href="/guide">
              <span>Training Guidelines</span>
              <span className="dash-guide-arrow">&rarr;</span>
            </a>
            <a className="dash-guide-item" href="/guide">
              <span>Nutrition &amp; Hydration</span>
              <span className="dash-guide-arrow">&rarr;</span>
            </a>
          </div>
        </section>

        {/* ── Right sidebar ── */}
        <aside className="dash-right">
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
                    const manualDone = isDayMarkedDone(dayEntry?.notes);
                    const allDone = manualDone || (hasActivities && dayEntry.activities.every((a: any) => a.completed));
                    const isToday = isTodayInsideCurrentWeek && day === isoDay;
                    const isMissed = isTodayInsideCurrentWeek && hasActivities && !allDone && day < isoDay;

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

          {/* Status feed */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Status</span>
            </div>
            <div className="dash-status-feed">
              {(recentDayStatuses.length > 0 ? recentDayStatuses : statusItems.slice(0, 5)).map((s, i) => (
                <div className="dash-status-item" key={i}>
                  <span className={`dash-status-dot ${s.alert ? "warn" : "ok"}`} />
                  {s.text}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
