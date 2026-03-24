'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import {
  appendPlanQueryToHref,
  extractPlanIdFromPathname,
  SELECTED_PLAN_COOKIE,
} from '@/lib/plan-selection';
import { emitCoachplanAnalytics, isCoarsePointerDevice } from '@/lib/client-runtime';
import styles from './MobileNav.module.css';

type NavTab = {
  href: string;
  label: string;
  icon: ReactNode;
  match: string[];
  planOnly?: boolean;
};

function resolveTabHref(tab: NavTab, contextualPlanId: string | null) {
  if (tab.planOnly) {
    return contextualPlanId ? tab.href.replace(':planId', contextualPlanId) : '/plans';
  }
  return appendPlanQueryToHref(tab.href, contextualPlanId);
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={styles.iconSvg}
      aria-hidden="true">
      {children}
    </svg>
  );
}

function readSelectedPlanCookie() {
  if (typeof document === 'undefined') return null;
  const prefix = `${SELECTED_PLAN_COOKIE}=`;
  const rawCookie = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  if (!rawCookie) return null;
  const value = rawCookie.slice(prefix.length);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const TABS: NavTab[] = [
  {
    href: '/dashboard', label: 'Today', match: ['/dashboard'],
    icon: (
      <Icon>
        {/* Sun — "today" */}
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </Icon>
    ),
  },
  {
    href: '/calendar', label: 'Calendar', match: ['/calendar'],
    icon: (
      <Icon>
        {/* Calendar grid */}
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
        <path d="M8 13h2M13 13h3M8 17h2M13 17h3" />
      </Icon>
    ),
  },
  {
    href: '/plans/:planId', label: 'Plan by Week', match: ['/plans'], planOnly: true,
    icon: (
      <Icon>
        {/* Document with lines */}
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M13 2v7h7M9 13h6M9 17h4" />
      </Icon>
    ),
  },
  {
    href: '/strava', label: 'Strava', match: ['/strava'],
    icon: (
      <Icon>
        {/* Running figure — mirrors ActivityTypeIcon RUN */}
        <circle cx="14.5" cy="4.5" r="1.3" />
        <path d="M7 18.5l2.5-5.5 3 2.5 2.5-4.5" />
        <path d="M6.5 11.5l3-3.5 4 1.5 2-3" />
      </Icon>
    ),
  },
  {
    href: '/progress', label: 'Progress', match: ['/progress'],
    icon: (
      <Icon>
        {/* Trend line chart */}
        <path d="M4 18l4.5-5.5 3.5 3 4-5.5 4 3" />
        <path d="M3 18h18" />
      </Icon>
    ),
  },
];

export default function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const preparedRoutesRef = useRef<Set<string>>(new Set());
  const contextualPlanId =
    extractPlanIdFromPathname(pathname)
    || searchParams.get('plan')
    || readSelectedPlanCookie();

  // Optimistic: show tapped tab as active immediately, before navigation settles
  const [pendingNav, setPendingNav] = useState<{ href: string; fromPath: string } | null>(null);

  const resolvedTabs = TABS.map((tab) => ({
    ...tab,
    href: resolveTabHref(tab, contextualPlanId),
  }));

  const prepareRoute = useCallback((href: string, source: 'touch' | 'hover' | 'focus') => {
    if (!href || preparedRoutesRef.current.has(href)) return;
    preparedRoutesRef.current.add(href);
    router.prefetch(href);
    emitCoachplanAnalytics({
      event: 'mobile_nav_prefetch_prepared',
      context: 'mobile_nav',
      href,
      source,
    });
  }, [router]);

  useEffect(() => {
    if (!isCoarsePointerDevice()) return;
    emitCoachplanAnalytics({
      event: 'mobile_nav_prefetch_suppressed',
      context: 'mobile_nav',
    });
  }, []);

  const { isSignedIn } = useAuth();

  const PUBLIC_ROUTES = ['/', '/sign-in', '/sign-up', '/auth/resolve-role', '/select-role'];
  const isPublicRoute = PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/')
  );

  if (!isSignedIn || isPublicRoute) return null;

  function isActive(tab: NavTab) {
    if (pendingNav?.href === tab.href && pendingNav.fromPath === pathname) return true;
    return tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
  }

  return (
    <nav className={styles.nav} aria-label="Mobile navigation">
      {resolvedTabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch={false}
          className={`${styles.tab}${isActive(tab) ? ` ${styles.active}` : ''}`}
          onClick={() => setPendingNav({ href: tab.href, fromPath: pathname })}
          onTouchStart={() => prepareRoute(tab.href, 'touch')}
          onMouseEnter={() => {
            if (isCoarsePointerDevice()) return;
            prepareRoute(tab.href, 'hover');
          }}
          onFocus={() => {
            if (isCoarsePointerDevice()) return;
            prepareRoute(tab.href, 'focus');
          }}
        >
          <span className={styles.icon}>{tab.icon}</span>
          <span className={styles.label}>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
