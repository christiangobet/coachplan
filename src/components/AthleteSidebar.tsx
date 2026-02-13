import Link from "next/link";

type AthleteNavItem = "today" | "calendar" | "progress" | "guide";

export default function AthleteSidebar({
  active,
  name,
  sticky = true,
  showQuickActions = true
}: {
  active?: AthleteNavItem;
  name: string;
  sticky?: boolean;
  showQuickActions?: boolean;
}) {
  return (
    <aside className={`dash-side${sticky ? "" : " no-sticky"}`}>
      <Link className="dash-side-brand" href="/dashboard">CoachPlan</Link>

      <nav className="dash-nav">
        <Link className={`dash-nav-item${active === "today" ? " active" : ""}`} href="/dashboard">
          <span className="dash-nav-dot" />
          Today
        </Link>
        <Link className={`dash-nav-item${active === "calendar" ? " active" : ""}`} href="/calendar">
          <span className="dash-nav-dot" />
          Calendar
        </Link>
        <Link className={`dash-nav-item${active === "progress" ? " active" : ""}`} href="/progress">
          <span className="dash-nav-dot" />
          Progress
        </Link>
        <Link className={`dash-nav-item${active === "guide" ? " active" : ""}`} href="/guide">
          <span className="dash-nav-dot" />
          Guide
        </Link>
      </nav>

      {showQuickActions && (
        <>
          <div className="dash-side-divider" />

          <div className="dash-connect">
            <span>Quick Actions</span>
            <Link className="dash-connect-btn" href="/upload">Upload Plan</Link>
            <Link className="dash-connect-btn" href="/plans">Manage Plans</Link>
            <Link className="dash-connect-btn" href="/profile">Profile Settings</Link>
          </div>
        </>
      )}

      <div className="dash-side-divider" />

      <div className="dash-side-user">
        <div className="dash-avatar" />
        <div>
          <div className="dash-user-name">{name}</div>
          <div className="dash-user-role">Athlete</div>
        </div>
      </div>
    </aside>
  );
}
