import Link from 'next/link';
import { appendPlanQueryToHref } from '@/lib/plan-selection';

type PlanSidebarItem = 'overview' | 'calendar' | 'ai' | 'strava' | 'progress';

const ITEMS: Array<{
  id: PlanSidebarItem;
  label: string;
  description: string;
  href: (planId: string) => string;
}> = [
  { id: 'overview', label: 'Overview', description: 'Plan summary and weekly structure', href: (planId) => `/plans/${planId}#plan-overview` },
  { id: 'calendar', label: 'Training Calendar', description: 'Calendar and day-level logging', href: (planId) => `/calendar?plan=${planId}` },
  { id: 'ai', label: 'AI Trainer', description: 'Adjustment recommendations', href: (planId) => `/plans/${planId}#ai-trainer` },
  { id: 'strava', label: 'Import Strava', description: 'Sync external activities', href: (planId) => appendPlanQueryToHref('/strava', planId) },
  { id: 'progress', label: 'Progress', description: 'Completion and performance trends', href: (planId) => `/progress?plan=${planId}` }
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
      <nav className="pcal-side-nav" aria-label="Plan navigation">
        {ITEMS.map((item) => (
          <Link
            key={item.id}
            className={`pcal-side-link${active === item.id ? ' active' : ''}`}
            href={item.href(planId)}
            title={item.label}
          >
            <span className="pcal-side-link-dot" aria-hidden />
            <span className="pcal-side-link-copy">
              <span className="pcal-side-link-label">{item.label}</span>
              <span className="pcal-side-link-meta">{item.description}</span>
            </span>
          </Link>
        ))}
      </nav>
      <div className="pcal-side-footer">
        <Link className="pcal-side-link back" href="/plans" title="Back to Plans">
          <span className="pcal-side-link-dot" aria-hidden />
          <span className="pcal-side-link-copy">
            <span className="pcal-side-link-label">← Plans</span>
            <span className="pcal-side-link-meta">Back to all plans</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
