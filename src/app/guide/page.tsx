import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { ensureUserFromAuth } from "@/lib/user-sync";
import AthleteSidebar from "@/components/AthleteSidebar";
import "../dashboard/dashboard.css";
import "./guide.css";

const playbooks = [
  {
    title: "Daily Routine",
    description: "Open Today, complete the workout, and log actual distance, duration, and pace.",
    actions: [
      { label: "Go to Today", href: "/dashboard" },
      { label: "View Training Log", href: "/calendar" }
    ]
  },
  {
    title: "Plan Setup",
    description: "Upload your plan, review parsing output, and align week timing to race day.",
    actions: [
      { label: "Upload Plan", href: "/upload" },
      { label: "Plans Management", href: "/plans" }
    ]
  },
  {
    title: "Performance Tracking",
    description: "Monitor completion trends weekly and adjust targets when training load shifts.",
    actions: [
      { label: "Open Progress", href: "/progress" },
      { label: "Edit Profile", href: "/profile" }
    ]
  },
  {
    title: "Coach Collaboration",
    description: "Connect with your coach and keep communication tied to your active training cycle.",
    actions: [
      { label: "Coach Hub", href: "/coach" },
      { label: "Athlete Profile", href: "/profile" }
    ]
  }
];

export default async function GuidePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const name = user.fullName || user.firstName || "Athlete";

  await ensureUserFromAuth(user, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE"
  });

  return (
    <main className="dash guide-page-shell">
      <div className="dash-grid">
        <AthleteSidebar active="guide" name={name} />

        <section className="dash-center">
          <div className="dash-card guide-header-card">
            <h1>Guide</h1>
            <p>Recommended workflows to get the most out of CoachPlan each training week.</p>
          </div>

          <div className="guide-grid">
            {playbooks.map((playbook) => (
              <article className="dash-card guide-card" key={playbook.title}>
                <h2>{playbook.title}</h2>
                <p>{playbook.description}</p>
                <div className="guide-actions">
                  {playbook.actions.map((action) => (
                    <Link key={action.href + action.label} href={action.href}>
                      {action.label}
                    </Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="dash-right">
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Quick Links</span>
            </div>
            <div className="guide-links">
              <Link href="/dashboard">Today dashboard</Link>
              <Link href="/calendar">Workout training log</Link>
              <Link href="/progress">Progress metrics</Link>
              <Link href="/plans">Plans Management</Link>
              <Link href="/upload">Upload new PDF</Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
