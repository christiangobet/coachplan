import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import CompleteWorkoutButton from "@/components/CompleteWorkoutButton";
import "./dashboard.css";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getIsoDay(date: Date) {
  const js = date.getDay();
  return js === 0 ? 7 : js;
}

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const email = user.primaryEmailAddress?.emailAddress || "";
  const name = user.fullName || user.firstName || "Athlete";

  await prisma.user.upsert({
    where: { id: user.id },
    update: { email, name },
    create: { id: user.id, email, name, role: "ATHLETE", currentRole: "ATHLETE" }
  });

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

  /* ── Empty / onboarding state ── */
  if (plans.length === 0) {
    return (
      <main className="dash">
        <div className="dash-atmosphere" />
        <div className="dash-topo" />
        <div className="dash-empty-content">
          <div className="dash-empty-hero">
            <h1>Welcome, {name}</h1>
            <p>Set up your first training plan. It only takes a couple of minutes.</p>
          </div>
          <div className="dash-empty-steps">
            <div className="dash-empty-step">
              <span className="dash-empty-num">01</span>
              <h3>Upload your plan</h3>
              <p>Upload a PDF training plan or pick an existing template.</p>
              <div className="dash-empty-actions">
                <a className="dash-empty-cta" href="/upload">Upload PDF</a>
                <a className="dash-empty-cta-outline" href="/plans">Templates</a>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">02</span>
              <h3>Set your race date</h3>
              <p>We'll align the plan weeks so training peaks on race weekend.</p>
              <div className="dash-empty-actions">
                <a className="dash-empty-cta-outline" href="/profile">Set date</a>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">03</span>
              <h3>Connect a coach</h3>
              <p>Invite or select a coach to review progress and adjust workouts.</p>
              <div className="dash-empty-actions">
                <a className="dash-empty-cta-outline" href="/coach">Find coach</a>
              </div>
            </div>
            <div className="dash-empty-step">
              <span className="dash-empty-num">04</span>
              <h3>Start logging</h3>
              <p>Track completion, pace, time, and distance versus your targets.</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ── Active plan data ── */
  const activePlan = plans.find((p) => p.status === "ACTIVE") || plans[0];

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

  const today = new Date();
  const isoDay = getIsoDay(today);
  const hour = today.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const weeks = [...(activePlan.weeks || [])].sort((a, b) => a.weekIndex - b.weekIndex);

  let currentWeek = weeks.find((w) => {
    if (!w.startDate || !w.endDate) return false;
    const start = new Date(w.startDate);
    const end = new Date(w.endDate);
    return today >= start && today <= end;
  });
  if (!currentWeek) currentWeek = weeks[0];

  const weekDays = [...(currentWeek?.days || [])].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const todayDay = weekDays.find((d) => d.dayOfWeek === isoDay);
  const todayActivity = todayDay?.activities?.[0] || null;

  /* Upcoming workouts */
  const upcoming: any[] = [];
  for (const day of weekDays) {
    if (day.dayOfWeek <= isoDay) continue;
    if (day.activities?.length) {
      upcoming.push({ ...day.activities[0], dayOfWeek: day.dayOfWeek });
    }
    if (upcoming.length >= 3) break;
  }
  const nextWeek = weeks.find((w) => currentWeek && w.weekIndex === currentWeek.weekIndex + 1);
  if (upcoming.length < 3 && nextWeek) {
    const nextWeekDays = [...(nextWeek.days || [])].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    for (const day of nextWeekDays) {
      if (upcoming.length >= 3) break;
      if (day.activities?.length) {
        upcoming.push({ ...day.activities[0], dayOfWeek: day.dayOfWeek });
      }
    }
  }

  /* Week statistics */
  const weekByDay = new Map<number, any>();
  weekDays.forEach((d) => weekByDay.set(d.dayOfWeek, d));

  const allActivities = weekDays.flatMap((d) => d.activities || []);
  const keyActivities = allActivities.filter((a) => a.mustDo || a.priority === "KEY");
  const completedKey = keyActivities.filter((a) => a.completed).length;
  const totalMinutes = allActivities.reduce((acc, a) => acc + (a.duration || 0), 0);

  /* Status items */
  const statusItems: { alert: boolean; text: string }[] = [];
  for (const day of weekDays) {
    for (const a of day.activities || []) {
      if (a.completed) {
        statusItems.push({ alert: false, text: `${a.title || a.type} completed` });
      } else if (a.type === "REST") {
        if (day.dayOfWeek < isoDay) {
          statusItems.push({ alert: false, text: "Rest day logged" });
        }
      } else if (day.dayOfWeek < isoDay) {
        statusItems.push({ alert: true, text: `Missed ${a.title || a.type}` });
      }
    }
  }
  const missedKey = keyActivities.filter(
    (a) => !a.completed && (weekDays.find((d) => d.activities?.includes(a))?.dayOfWeek ?? isoDay) < isoDay
  );
  if (missedKey.length === 0) {
    statusItems.unshift({ alert: false, text: "You're on track" });
  } else {
    statusItems.unshift({ alert: true, text: "Behind on key workouts" });
  }

  /* Plan progress */
  const currentWeekIndex = currentWeek ? weeks.indexOf(currentWeek) + 1 : 1;
  const totalWeeks = weeks.length;
  const allPlanActivities = weeks.flatMap((w) =>
    (w.days || []).flatMap((d: any) => d.activities || [])
  );
  const totalActivities = allPlanActivities.length;
  const completedActivities = allPlanActivities.filter((a: any) => a.completed).length;
  const completionPct = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

  const isRestDay = !todayActivity || todayActivity.type === "REST";

  return (
    <main className="dash">
      <div className="dash-atmosphere" />
      <div className="dash-topo" />

      <div className="dash-grid">
        {/* ── Sidebar ── */}
        <aside className="dash-side">
          <div className="dash-side-brand">CoachPlan</div>

          <nav className="dash-nav">
            <a className="dash-nav-item active" href="/dashboard">
              <span className="dash-nav-dot" />
              Today
            </a>
            <a className="dash-nav-item" href="/calendar">
              <span className="dash-nav-dot" />
              Calendar
            </a>
            <a className="dash-nav-item" href="/progress">
              <span className="dash-nav-dot" />
              Progress
            </a>
            <a className="dash-nav-item" href="/guide">
              <span className="dash-nav-dot" />
              Guide
            </a>
          </nav>

          <div className="dash-side-divider" />

          <div className="dash-connect">
            <span>Connect Strava or Garmin</span>
            <button className="dash-connect-btn" type="button">Connect</button>
          </div>

          <div className="dash-side-divider" />

          <div className="dash-side-user">
            <div className="dash-avatar" />
            <div>
              <div className="dash-user-name">{name}</div>
              <div className="dash-user-role">Athlete</div>
            </div>
          </div>
        </aside>

        {/* ── Center ── */}
        <section className="dash-center">
          <div className="dash-greeting">
            <h1>{greeting}, {name}</h1>
            <div className="dash-greeting-date">{dateStr}</div>
          </div>

          {/* Today's workout hero */}
          <div className={`dash-hero${isRestDay ? " dash-hero-rest" : ""}`}>
            <div className="dash-hero-label">
              {isRestDay ? "Rest Day" : "Today's Workout"}
            </div>
            {todayActivity && (
              <span className={`dash-type-badge dash-type-${todayActivity.type}`}>
                {formatType(todayActivity.type)}
              </span>
            )}
            <h2 className="dash-hero-title">
              {todayActivity?.title || "Recovery & Rest"}
            </h2>
            <div className="dash-hero-meta">
              {todayActivity?.duration && (
                <span>{todayActivity.duration} min</span>
              )}
              {todayActivity?.duration && todayActivity?.distance && (
                <span className="dash-hero-sep" />
              )}
              {todayActivity?.distance && (
                <span>{todayActivity.distance} {todayActivity.distanceUnit?.toLowerCase() || "mi"}</span>
              )}
              {!todayActivity?.duration && !todayActivity?.distance && (
                <span>Follow plan notes</span>
              )}
            </div>
            {todayActivity?.rawText && (
              <div className="dash-hero-detail">{todayActivity.rawText}</div>
            )}
            <div className="dash-hero-actions">
              {todayActivity ? (
                <>
                  <CompleteWorkoutButton activityId={todayActivity.id} />
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

          {/* Upcoming workouts */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Next Up</span>
              <a className="dash-card-link" href={`/plans/${activePlan.id}`}>
                Full plan
              </a>
            </div>
            {upcoming.length === 0 && (
              <p style={{ color: "var(--d-muted)", fontSize: 14 }}>
                No upcoming workouts this week.
              </p>
            )}
            {upcoming.map((a) => (
              <div className="dash-upcoming-item" key={a.id}>
                <div className="dash-upcoming-left">
                  <div className="dash-upcoming-day">
                    {DAY_LABELS[(a.dayOfWeek || 1) - 1]}
                  </div>
                  <div className="dash-upcoming-info">
                    <span className="dash-upcoming-title">{a.title}</span>
                    <span className="dash-upcoming-type">{formatType(a.type)}</span>
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
            <div className="dash-card-header">
              <span className="dash-card-title">This Week</span>
              <span style={{ fontSize: 12, color: "var(--d-muted)" }}>
                Week {currentWeekIndex}
              </span>
            </div>
            <div className="dash-week-strip">
              {DAY_LABELS.map((label, idx) => {
                const day = idx + 1;
                const dayEntry = weekByDay.get(day);
                const hasActivities = dayEntry?.activities?.length > 0;
                const allDone = hasActivities && dayEntry.activities.every((a: any) => a.completed);
                const isToday = day === isoDay;
                const isMissed = hasActivities && !allDone && day < isoDay;

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

          {/* Plan progress */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Plan Progress</span>
            </div>
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

          {/* Status feed */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Status</span>
            </div>
            <div className="dash-status-feed">
              {statusItems.slice(0, 5).map((s, i) => (
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
