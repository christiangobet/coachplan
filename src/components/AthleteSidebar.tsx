'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { appendPlanQueryToHref, extractPlanIdFromPathname } from "@/lib/plan-selection";
import { getFirstName } from "@/lib/display-name";
import BrandLogo from "@/components/BrandLogo";

type AthleteNavItem =
  | "dashboard"
  | "today"
  | "calendar"
  | "strava"
  | "plans"
  | "plan-view"
  | "progress"
  | "coach"
  | "admin"
  | "profile"
  | "guide";

const NAV_ITEMS: Array<{ id: AthleteNavItem; href: string; label: string; planOnly?: boolean }> = [
  { id: "dashboard", href: "/dashboard", label: "Today" },
  { id: "calendar", href: "/calendar", label: "Training Calendar" },
  { id: "plan-view", href: "/plans/:planId", label: "Plan by Week", planOnly: true },
  { id: "strava", href: "/strava", label: "Import Strava" },
  { id: "plans", href: "/plans", label: "Plans Library" },
  { id: "progress", href: "/progress", label: "Progress" },
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
  const displayName = getFirstName(name, "Athlete");

  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('cp-debug') === '1';
  });

  useEffect(() => {
    document.body.classList.toggle('debug-mode', debugMode);
    return () => {
      document.body.classList.remove('debug-mode');
    };
  }, [debugMode]);

  function toggleDebug() {
    const next = !debugMode;
    setDebugMode(next);
    localStorage.setItem('cp-debug', next ? '1' : '0');
    document.body.classList.toggle('debug-mode', next);
  }

  const initials = displayName.slice(0, 2).toUpperCase() || "CP";

  const isActive = (id: AthleteNavItem) =>
    active === id || (id === "dashboard" && active === "today");

  return (
    <aside className={`dash-side${sticky ? "" : " no-sticky"}`} data-debug-id="NAV">
      <Link className="dash-side-brand" href={appendPlanQueryToHref("/dashboard", contextualPlanId)}>
        <BrandLogo variant="app" size="sidebar" />
      </Link>

      <nav className="dash-nav">
        {NAV_ITEMS.flatMap((item) => {
          if (item.planOnly && !contextualPlanId) return [];
          const href = item.planOnly
            ? `/plans/${contextualPlanId}`
            : appendPlanQueryToHref(item.href, contextualPlanId);
          return [(
            <Link
              key={item.id}
              className={`dash-nav-item${isActive(item.id) ? " active" : ""}`}
              href={href}
            >
              <span className="dash-nav-dot" />
              {item.label}
            </Link>
          )];
        })}
      </nav>

      {showQuickActions && (
        <>
          <div className="dash-side-divider" />

          <div className="dash-connect">
            <span>Quick Actions</span>
            <Link className="dash-connect-btn" href={appendPlanQueryToHref("/plans", contextualPlanId)}>Plans Library</Link>
            <Link className="dash-connect-btn" href={appendPlanQueryToHref("/profile", contextualPlanId)}>Profile Settings</Link>
          </div>
        </>
      )}

      <div className="dash-side-divider" />

      <div className="dash-side-user">
        <div className="dash-avatar">{initials}</div>
        <div>
          <div className="dash-user-name">{displayName}</div>
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
