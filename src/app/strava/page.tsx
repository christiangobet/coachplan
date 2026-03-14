import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import AthleteSidebar from "@/components/AthleteSidebar";
import StravaSyncPanel from "@/components/StravaSyncPanel";
import StravaActivityMatchTable from "@/components/StravaActivityMatchTable";
import { buildCalendarDayDetailsHref } from "@/lib/athlete-flow-ui";
import { getFirstName } from "@/lib/display-name";
import { appendPlanQueryToHref } from "@/lib/plan-selection";
import "../dashboard/dashboard.css";
import "./strava.css";

type StravaSearchParams = {
  plan?: string;
};

export default async function StravaPage({
  searchParams
}: {
  searchParams?: Promise<StravaSearchParams>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const params = (await searchParams) || {};
  const selectedPlanId = typeof params.plan === "string" ? params.plan : "";
  const name = getFirstName(user.fullName || user.firstName || "Athlete");
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todayCalendarHref = buildCalendarDayDetailsHref(todayIso, selectedPlanId || null);
  const todayDashboardHref = `${appendPlanQueryToHref("/dashboard", selectedPlanId)}#dash-activity-log-card`;

  return (
    <main className="dash strava-page">
      <div className="dash-atmosphere" />
      <div className="dash-topo" />

      <div className="dash-grid">
        <div className="dash-left-col">
          <AthleteSidebar
            active="strava"
            name={name}
            sticky={false}
            showQuickActions={false}
            selectedPlanId={selectedPlanId}
          />
          <StravaSyncPanel compact />
        </div>

        <section className="dash-center">
          <div className="dash-page-heading">
            <h1>Import Strava</h1>
            <p>Sync first, review the day-level matches, then jump back into today or the calendar when you are ready to log.</p>
          </div>

          <div className="strava-mobile-sync">
            <StravaSyncPanel />
          </div>

          <div className="strava-table-scroll">
            <StravaActivityMatchTable />
          </div>
          <div className="strava-secondary-grid">
            <div className="dash-card strava-info-card">
              <div className="dash-card-header">
                <span className="dash-card-title">How It Works</span>
              </div>
              <ol className="strava-steps">
                <li>Connect Strava and run sync.</li>
                <li>Compare each day and import only the rows you want.</li>
                <li>Use re-import when you update workouts in Strava.</li>
                <li>Closed days are read-only for import. Reopen them from Calendar first.</li>
              </ol>
            </div>

            <div className="dash-card strava-info-card">
              <div className="dash-card-header">
                <span className="dash-card-title">Shortcuts</span>
              </div>
              <div className="strava-links">
                <Link className="dash-connect-btn" href={todayDashboardHref}>
                  Open today&apos;s log
                </Link>
                <Link className="dash-connect-btn" href={todayCalendarHref}>
                  Open today&apos;s day card
                </Link>
                <Link className="dash-connect-btn" href={appendPlanQueryToHref("/progress", selectedPlanId)}>
                  Open Progress
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
