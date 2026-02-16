import Link from 'next/link';
import { appendPlanQueryToHref } from '@/lib/plan-selection';

type PlanSidebarItem = 'overview' | 'calendar' | 'ai' | 'strava' | 'progress';

const ITEMS: Array<{ id: PlanSidebarItem; label: string; href: (planId: string) => string }> = [
  { id: 'overview', label: 'Overview', href: (planId) => `/plans/${planId}#plan-overview` },
  { id: 'calendar', label: 'Calendar', href: (planId) => `/calendar?plan=${planId}` },
  { id: 'ai', label: 'AI Trainer', href: (planId) => `/plans/${planId}#ai-trainer` },
  { id: 'strava', label: 'Import Strava', href: (planId) => appendPlanQueryToHref('/strava', planId) },
  { id: 'progress', label: 'Progress', href: (planId) => `/progress?plan=${planId}` }
];

export default function PlanSidebar({
  planId,
  active
}: {
  planId: string;
  active: PlanSidebarItem;
}) {
  return (
    <aside className="pcal-side">
      <div className="pcal-side-title">Plan Menu</div>
      <nav className="pcal-side-nav" aria-label="Plan navigation">
        {ITEMS.map((item) => (
          <Link
            key={item.id}
            className={`pcal-side-link${active === item.id ? ' active' : ''}`}
            href={item.href(planId)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="pcal-side-footer">
        <Link className="pcal-side-link back" href="/plans">
          Back to Plans
        </Link>
      </div>
    </aside>
  );
}
