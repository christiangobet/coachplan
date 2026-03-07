'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import styles from './MobileNav.module.css';

type NavTab = { href: string; label: string; icon: string; match: string[] };

const TABS: NavTab[] = [
  { href: '/dashboard', label: 'Today',    icon: '⚡', match: ['/dashboard'] },
  { href: '/calendar',  label: 'Calendar', icon: '📅', match: ['/calendar'] },
  { href: '/plans',     label: 'Plans',    icon: '📋', match: ['/plans'] },
  { href: '/strava',    label: 'Strava',   icon: '🔗', match: ['/strava'] },
  { href: '/progress',  label: 'Progress', icon: '📈', match: ['/progress'] },
];

export default function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const planId = searchParams.get('plan') ?? '';

  function buildHref(base: string) {
    return planId ? `${base}?plan=${planId}` : base;
  }

  function isActive(tab: NavTab) {
    return tab.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
  }

  return (
    <nav className={styles.nav} aria-label="Mobile navigation">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={buildHref(tab.href)}
          className={`${styles.tab}${isActive(tab) ? ` ${styles.active}` : ''}`}
        >
          <span className={styles.icon} aria-hidden="true">{tab.icon}</span>
          <span className={styles.label}>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
