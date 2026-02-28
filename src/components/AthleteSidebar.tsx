'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { appendPlanQueryToHref, extractPlanIdFromPathname } from "@/lib/plan-selection";

type AthleteNavItem =
  | "dashboard"
  | "today"
  | "calendar"
  | "strava"
  | "plans"
  | "progress"
  | "coach"
  | "admin"
  | "profile"
  | "guide";

const NAV_ITEMS: Array<{ id: AthleteNavItem; href: string; label: string }> = [
  { id: "dashboard", href: "/dashboard", label: "Today" },
  { id: "calendar", href: "/calendar", label: "Training Calendar" },
  { id: "strava", href: "/strava", label: "Import Strava" },
  { id: "plans", href: "/plans", label: "Plans Management" },
  { id: "progress", href: "/progress", label: "Progress" },
  { id: "coach", href: "/coach", label: "Coach" },
  { id: "admin", href: "/admin", label: "Admin" },
  { id: "profile", href: "/profile", label: "Profile" },
  { id: "guide", href: "/guide", label: "Guide" }
];

export default function AthleteSidebar({
  active,
  name,
  sticky = true,
  showQuickActions = false,
  selectedPlanId = null
}: {
  active?: AthleteNavItem;
  name: string;
  sticky?: boolean;
  showQuickActions?: boolean;
  selectedPlanId?: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const contextualPlanId =
    selectedPlanId
    || searchParams.get("plan")
    || extractPlanIdFromPathname(pathname);

  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    const on = localStorage.getItem('cp-debug') === '1';
    setDebugMode(on);
    document.body.classList.toggle('debug-mode', on);
  }, []);

  function toggleDebug() {
    const next = !debugMode;
    setDebugMode(next);
    localStorage.setItem('cp-debug', next ? '1' : '0');
    document.body.classList.toggle('debug-mode', next);
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .slice(0, 2)
    .join("") || "CP";

  const isActive = (id: AthleteNavItem) =>
    active === id || (id === "dashboard" && active === "today");

  return (
    <aside className={`dash-side${sticky ? "" : " no-sticky"}`} data-debug-id="NAV">
      <Link className="dash-side-brand" href={appendPlanQueryToHref("/dashboard", contextualPlanId)}>
        <span>Coach</span> Plan
      </Link>

      <nav className="dash-nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.id}
            className={`dash-nav-item${isActive(item.id) ? " active" : ""}`}
            href={appendPlanQueryToHref(item.href, contextualPlanId)}
          >
            <span className="dash-nav-dot" />
            {item.label}
          </Link>
        ))}
      </nav>

      {showQuickActions && (
        <>
          <div className="dash-side-divider" />

          <div className="dash-connect">
            <span>Quick Actions</span>
            <Link className="dash-connect-btn" href={appendPlanQueryToHref("/plans", contextualPlanId)}>Plans Management</Link>
            <Link className="dash-connect-btn" href={appendPlanQueryToHref("/profile", contextualPlanId)}>Profile Settings</Link>
          </div>
        </>
      )}

      <div className="dash-side-divider" />

      <div className="dash-side-user">
        <div className="dash-avatar">{initials}</div>
        <div>
          <div className="dash-user-name">{name}</div>
          <div className="dash-user-role">Athlete</div>
        </div>
      </div>

      <div className="dash-side-debug">
        <button
          type="button"
          className={`dash-nav-item dash-debug-toggle${debugMode ? ' active' : ''}`}
          onClick={toggleDebug}
          title="Toggle debug mode — shows component IDs"
        >
          <span className="dash-nav-dot" />
          Debug
          <span className={`dash-debug-pill${debugMode ? ' on' : ''}`}>{debugMode ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </aside>
  );
}
