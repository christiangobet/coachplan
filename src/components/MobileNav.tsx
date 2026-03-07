'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import styles from './MobileNav.module.css';

type NavTab = { href: string; label: string; icon: ReactNode; match: string[] };

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={styles.iconSvg}
      aria-hidden="true">
      {children}
    </svg>
  );
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
    href: '/plans', label: 'Plans', match: ['/plans'],
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
  const planId = searchParams.get('plan') ?? '';

  // Optimistic: show tapped tab as active immediately, before navigation settles
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Clear pending once pathname actually changes
  useEffect(() => { setPendingHref(null); }, [pathname]);

  // Prefetch all tab routes on mount so navigation is instant
  useEffect(() => {
    TABS.forEach((tab) => router.prefetch(tab.href));
  }, [router]);

  function buildHref(base: string) {
    return planId ? `${base}?plan=${planId}` : base;
  }

  function isActive(tab: NavTab) {
    if (pendingHref === tab.href) return true;
    return tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
  }

  return (
    <nav className={styles.nav} aria-label="Mobile navigation">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={buildHref(tab.href)}
          className={`${styles.tab}${isActive(tab) ? ` ${styles.active}` : ''}`}
          onClick={() => setPendingHref(tab.href)}
        >
          <span className={styles.icon}>{tab.icon}</span>
          <span className={styles.label}>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
