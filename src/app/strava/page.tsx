import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import AthleteSidebar from "@/components/AthleteSidebar";
import StravaSyncPanel from "@/components/StravaSyncPanel";
import StravaActivityMatchTable from "@/components/StravaActivityMatchTable";
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
  const name = user.fullName || user.firstName || "Athlete";

  return (
    <main className="dash">
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
            <p>Review planned sessions against synced Strava activities and import by day.</p>
          </div>

          <div className="strava-mobile-sync">
            <StravaSyncPanel />
          </div>

          <StravaActivityMatchTable />
        </section>

        <aside className="dash-right strava-right">
          <div className="dash-card strava-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">How It Works</span>
            </div>
            <ol className="strava-steps">
              <li>Connect Strava and run sync.</li>
              <li>Compare each day and import only the rows you want.</li>
              <li>Use re-import when you update workouts in Strava.</li>
            </ol>
          </div>

          <div className="dash-card strava-info-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Shortcuts</span>
            </div>
            <div className="strava-links">
              <Link className="dash-connect-btn" href={appendPlanQueryToHref("/calendar", selectedPlanId)}>
                Open Training Log
              </Link>
              <Link className="dash-connect-btn" href={appendPlanQueryToHref("/progress", selectedPlanId)}>
                Open Progress
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
