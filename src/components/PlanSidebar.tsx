import Link from 'next/link';
import { appendPlanQueryToHref } from '@/lib/plan-selection';

type PlanSidebarItem = 'overview' | 'calendar' | 'ai' | 'strava' | 'progress';

const ITEMS: Array<{
  id: PlanSidebarItem;
  label: string;
  shortLabel: string;
  href: (planId: string) => string;
}> = [
  { id: 'overview', label: 'Overview', shortLabel: 'OV', href: (planId) => `/plans/${planId}#plan-overview` },
  { id: 'calendar', label: 'Calendar', shortLabel: 'CAL', href: (planId) => `/calendar?plan=${planId}` },
  { id: 'ai', label: 'AI Trainer', shortLabel: 'AI', href: (planId) => `/plans/${planId}#ai-trainer` },
  { id: 'strava', label: 'Import Strava', shortLabel: 'IMP', href: (planId) => appendPlanQueryToHref('/strava', planId) },
  { id: 'progress', label: 'Progress', shortLabel: 'PRG', href: (planId) => `/progress?plan=${planId}` }
];

export default function PlanSidebar({
  planId,
  active,
  collapsed = false,
  onToggleCollapse
}: {
  planId: string;
  active: PlanSidebarItem;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <aside className={`pcal-side${collapsed ? ' is-collapsed' : ''}`}>
      <div className="pcal-side-head">
        <div className="pcal-side-title">{collapsed ? 'Menu' : 'Plan Menu'}</div>
        {onToggleCollapse && (
          <button
            className="pcal-side-toggle"
            type="button"
            aria-label={collapsed ? 'Expand plan menu' : 'Collapse plan menu'}
            onClick={onToggleCollapse}
          >
            {collapsed ? '>' : '<'}
          </button>
        )}
      </div>
      <nav className="pcal-side-nav" aria-label="Plan navigation">
        {ITEMS.map((item) => (
          <Link
            key={item.id}
            className={`pcal-side-link${active === item.id ? ' active' : ''}`}
            href={item.href(planId)}
            title={item.label}
          >
            <span className="pcal-side-link-short">{item.shortLabel}</span>
            <span className="pcal-side-link-label">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="pcal-side-footer">
        <Link className="pcal-side-link back" href="/plans" title="Back to Plans">
          <span className="pcal-side-link-short">BK</span>
          <span className="pcal-side-link-label">Back to Plans</span>
        </Link>
      </div>
    </aside>
  );
}
