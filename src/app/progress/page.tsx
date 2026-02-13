import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserFromAuth } from "@/lib/user-sync";
import AthleteSidebar from "@/components/AthleteSidebar";
import "../dashboard/dashboard.css";
import "./progress.css";

export default async function ProgressPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const name = user.fullName || user.firstName || "Athlete";

  await ensureUserFromAuth(user, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE"
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

  if (plans.length === 0) redirect("/dashboard");

  const activePlan = plans.find((p) => p.status === "ACTIVE") || plans[0];
  if (!activePlan) redirect("/dashboard");

  const allActivities = plans.flatMap((plan) =>
    plan.weeks.flatMap((week) => week.days.flatMap((day) => day.activities))
  );
  const totalWorkouts = allActivities.length;
  const completedWorkouts = allActivities.filter((activity) => activity.completed).length;
  const completionRate = totalWorkouts > 0 ? Math.round((completedWorkouts / totalWorkouts) * 100) : 0;

  const keyWorkouts = allActivities.filter((activity) => activity.mustDo || activity.priority === "KEY");
  const keyCompleted = keyWorkouts.filter((activity) => activity.completed).length;
  const keyRate = keyWorkouts.length > 0 ? Math.round((keyCompleted / keyWorkouts.length) * 100) : 0;

  const weekProgress = [...activePlan.weeks]
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map((week) => {
      const activities = week.days.flatMap((day) => day.activities);
      const total = activities.length;
      const completed = activities.filter((activity) => activity.completed).length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      return {
        id: week.id,
        weekIndex: week.weekIndex,
        total,
        completed,
        percent
      };
    });

  const recentWeeks = weekProgress.slice(Math.max(0, weekProgress.length - 8));
  const bestWeek = weekProgress.reduce(
    (best, week) => (week.percent > best.percent ? week : best),
    { id: "none", weekIndex: 0, total: 0, completed: 0, percent: 0 }
  );

  const today = new Date();
  const currentWeek = activePlan.weeks.find((week) => {
    if (!week.startDate || !week.endDate) return false;
    const start = new Date(week.startDate);
    const end = new Date(week.endDate);
    return today >= start && today <= end;
  });
  const currentWeekStats = weekProgress.find((week) => week.id === currentWeek?.id);

  return (
    <main className="dash prog-page-shell">
      <div className="dash-grid">
        <AthleteSidebar active="progress" name={name} />

        <section className="dash-center">
          <div className="dash-card prog-header-card">
            <h1>Progress</h1>
            <p>Track how consistently you execute your training plan week by week.</p>
          </div>

          <div className="prog-metric-grid">
            <article className="dash-card prog-metric-card">
              <h2>Overall Completion</h2>
              <div className="prog-big">{completionRate}%</div>
              <p>{completedWorkouts} of {totalWorkouts} workouts completed</p>
            </article>

            <article className="dash-card prog-metric-card">
              <h2>Key Workout Completion</h2>
              <div className="prog-big">{keyRate}%</div>
              <p>{keyCompleted} of {keyWorkouts.length} key sessions done</p>
            </article>

            <article className="dash-card prog-metric-card">
              <h2>Current Week</h2>
              <div className="prog-big">{currentWeekStats?.percent ?? 0}%</div>
              <p>
                {currentWeekStats?.completed ?? 0} of {currentWeekStats?.total ?? 0} workouts
              </p>
            </article>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Weekly Trend</span>
            </div>
            <div className="prog-trend-list">
              {recentWeeks.length === 0 && (
                <p className="prog-muted">No weekly data yet.</p>
              )}
              {recentWeeks.map((week) => (
                <div className="prog-week-row" key={week.id}>
                  <span className="prog-week-label">Week {week.weekIndex}</span>
                  <div className="prog-week-bar">
                    <div className="prog-week-fill" style={{ width: `${week.percent}%` }} />
                  </div>
                  <span className="prog-week-pct">{week.percent}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="dash-right">
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
                <strong>Active plan</strong>
                <span>{activePlan.name}</span>
              </div>
              <div>
                <strong>Total plans</strong>
                <span>{plans.length}</span>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Actions</span>
            </div>
            <div className="prog-actions">
              <Link href="/dashboard">Log today&apos;s workout</Link>
              <Link href={`/plans/${activePlan.id}`}>Review plan calendar</Link>
              <Link href="/profile">Update race targets</Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
