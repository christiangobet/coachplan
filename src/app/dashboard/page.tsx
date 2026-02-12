import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import CompleteWorkoutButton from "@/components/CompleteWorkoutButton";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getIsoDay(date: Date) {
  const js = date.getDay();
  return js === 0 ? 7 : js;
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

  if (plans.length === 0) {
    return (
      <main>
        <section className="card white">
          <div className="section-title">
            <h1>Welcome, {name}</h1>
          </div>
          <p className="muted">
            Let’s set up your first training plan. This takes about 2 minutes.
          </p>
        </section>

        <section className="container" style={{ marginTop: 24 }}>
          <div className="grid-2">
            <div className="card white">
              <h3>Step 1: Choose your start</h3>
              <p className="muted">
                Upload a PDF plan or select an existing template.
              </p>
              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a className="cta" href="/upload">Upload PDF</a>
                <a className="cta secondary" href="/plans">Choose template</a>
              </div>
            </div>
            <div className="card white">
              <h3>Step 2: Add your race date</h3>
              <p className="muted">
                We’ll align the weeks so the plan ends on race weekend.
              </p>
              <div style={{ marginTop: 12 }}>
                <a className="cta" href="/profile">Set race date</a>
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 20 }}>
            <div className="card white">
              <h3>Step 3: Connect your coach</h3>
              <p className="muted">
                Invite or select a coach to review progress and adjust workouts.
              </p>
              <div style={{ marginTop: 12 }}>
                <a className="cta secondary" href="/coach">Find coach</a>
              </div>
            </div>
            <div className="card white">
              <h3>Step 4: Start logging</h3>
              <p className="muted">
                Track completion, pace, time, and distance vs target.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const activePlan =
    plans.find((p) => p.status === "ACTIVE") || plans[0];

  if (!activePlan) {
    return (
      <main className="container">
        <p className="muted">No plans available.</p>
      </main>
    );
  }

  const today = new Date();
  const isoDay = getIsoDay(today);

  const weeks = [...(activePlan.weeks || [])].sort(
    (a, b) => a.weekIndex - b.weekIndex
  );

  let currentWeek = weeks.find((w) => {
    if (!w.startDate || !w.endDate) return false;
    const start = new Date(w.startDate);
    const end = new Date(w.endDate);
    return today >= start && today <= end;
  });
  if (!currentWeek) currentWeek = weeks[0];

  const weekDays = [...(currentWeek?.days || [])].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek
  );

  const todayDay = weekDays.find((d) => d.dayOfWeek === isoDay);
  const todayActivity = todayDay?.activities?.[0] || null;

  const upcoming: any[] = [];
  for (const day of weekDays) {
    if (day.dayOfWeek <= isoDay) continue;
    if (day.activities?.length) {
      upcoming.push({ ...day.activities[0], dayOfWeek: day.dayOfWeek });
    }
    if (upcoming.length >= 2) break;
  }

  const nextWeek = weeks.find((w) => currentWeek && w.weekIndex === currentWeek.weekIndex + 1);
  if (upcoming.length < 2 && nextWeek) {
    const nextWeekDays = [...(nextWeek.days || [])].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek
    );
    for (const day of nextWeekDays) {
      if (upcoming.length >= 2) break;
      if (day.activities?.length) {
        upcoming.push({ ...day.activities[0], dayOfWeek: day.dayOfWeek });
      }
    }
  }

  const weekByDay = new Map<number, any>();
  weekDays.forEach((d) => weekByDay.set(d.dayOfWeek, d));

  const allActivities = weekDays.flatMap((d) => d.activities || []);
  const keyActivities = allActivities.filter((a) =>
    a.mustDo || a.priority === "KEY"
  );
  const completedKey = keyActivities.filter((a) => a.completed).length;
  const totalMinutes = allActivities.reduce((acc, a) => acc + (a.duration || 0), 0);

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span>My Training Coach Pro</span>
        </div>
        <nav className="sidebar-nav">
          <a className="sidebar-item active" href="/dashboard">Today</a>
          <a className="sidebar-item" href="/calendar">Calendar</a>
          <a className="sidebar-item" href="/progress">Progress</a>
          <a className="sidebar-item" href="/guide">Guide</a>
        </nav>
        <div className="sidebar-note">
          <div>Connect Strava or Garmin</div>
          <button className="btn-light" type="button">Connect</button>
        </div>
          <div className="sidebar-footer">
            <div className="avatar" />
            <div>
              <div>{name}</div>
              <span className="muted">Athlete</span>
            </div>
          </div>
      </aside>

      <section className="dashboard-main">
        <div className="section-title">
          <h1>Today</h1>
        </div>

        <div className="card white">
          <h3>Today’s Workout</h3>
          <div className="today-card" style={{ marginTop: 12 }}>
            <div>
              <h2>{todayActivity?.title || "Rest day"}</h2>
              <p className="muted" style={{ color: "#e6f4ef" }}>
                {todayActivity?.duration ? `${todayActivity.duration} min` : "Follow plan notes"}
              </p>
              {todayActivity?.rawText && (
                <div className="mini-pill" style={{ marginTop: 10 }}>{todayActivity.rawText}</div>
              )}
            </div>
            <div className="today-actions">
              {todayActivity ? (
                <CompleteWorkoutButton activityId={todayActivity.id} />
              ) : (
                <button className="btn-light" type="button" disabled>Mark as Complete</button>
              )}
              <a className="btn-ghost" href={`/plans/${activePlan.id}`}>Log Activity</a>
            </div>
          </div>
        </div>

        <div className="card white">
          <h3>Upcoming Workouts</h3>
          {upcoming.length === 0 && <p className="muted">No upcoming workouts this week.</p>}
          {upcoming.map((a, idx) => (
            <div className="workout-row" key={a.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`tag ${idx === 0 ? "yellow" : "green"}`}>
                  {DAY_LABELS[(a.dayOfWeek || 1) - 1]?.[0] || "W"}
                </span>
                {a.title}
              </div>
              <span>{a.duration ? `${a.duration} min` : "—"}</span>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <a className="muted" href={`/plans/${activePlan.id}`}>View Plan →</a>
          </div>
        </div>

        <div className="card white">
          <h3>Guide</h3>
          <p className="muted">Training tips from your plan and coach.</p>
          <div className="workout-row" style={{ marginTop: 12 }}>
            <span>Training Guidelines</span>
            <span>→</span>
          </div>
          <div className="workout-row">
            <span>Nutrition &amp; Hydration</span>
            <span>→</span>
          </div>
        </div>
      </section>

      <aside className="dashboard-right">
        <div className="card white">
          <h3>Weekly Overview</h3>
          <div className="overview-grid">
            {DAY_LABELS.map((d) => (
              <span key={d}>{d[0]}</span>
            ))}
            {DAY_LABELS.map((_, idx) => {
              const day = idx + 1;
              const dayEntry = weekByDay.get(day);
              if (!dayEntry || !dayEntry.activities?.length) {
                return <span key={`empty-${day}`} className="day-pill">•</span>;
              }
              const allDone = dayEntry.activities.every((a: any) => a.completed);
              if (allDone) return <span key={`done-${day}`} className="day-pill done">✓</span>;
              if (day < isoDay) return <span key={`miss-${day}`} className="day-pill miss">✕</span>;
              return <span key={`up-${day}`} className="day-pill warn">•</span>;
            })}
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 14 }}>
            <div>Key Workouts: {completedKey} / {keyActivities.length}</div>
            <div>Total Time: {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</div>
          </div>
        </div>

        <div className="card white">
          <h3>Status</h3>
          <div className="status-list" style={{ marginTop: 10 }}>
            <div className="status-item">
              <span className="check">✓</span>
              You’re on track!
            </div>
            <div className="status-item">
              <span className="check">✓</span>
              Long Run completed
            </div>
            <div className="status-item">
              <span className="check alert">!</span>
              Missed Tempo Run
            </div>
            <div className="status-item">
              <span className="check">✓</span>
              Rest Day logged
            </div>
          </div>
        </div>

        <div className="card white">
          <h3>Wellness Check-In</h3>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Energy</span>
                <span>Okay</span>
              </div>
              <div className="wellness-bar">
                <div className="wellness-fill green" style={{ width: "65%" }} />
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Sleep</span>
                <span>Good</span>
              </div>
              <div className="wellness-bar">
                <div className="wellness-fill blue" style={{ width: "78%" }} />
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Soreness</span>
                <span>Mild</span>
              </div>
              <div className="wellness-bar">
                <div className="wellness-fill orange" style={{ width: "45%" }} />
              </div>
            </div>
          </div>
          <button className="cta" style={{ marginTop: 16 }} type="button">Log Daily Check-In</button>
        </div>
      </aside>
    </main>
  );
}
