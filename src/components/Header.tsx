'use client';

import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
    appendPlanQueryToHref,
    extractPlanIdFromPathname,
    SELECTED_PLAN_COOKIE
} from '@/lib/plan-selection';

type NavItem = { href: string; label: string };

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

export default function Header({
    brand,
    brandHref,
    roleChip,
    roleChipClass,
    navItems,
    roleSwitchHref,
    isSignedIn,
    isAccountInactive
}: {
    brand: string;
    brandHref: string;
    roleChip?: string;
    roleChipClass?: string;
    navItems: NavItem[];
    roleSwitchHref?: string | null;
    isSignedIn: boolean;
    isAccountInactive?: boolean;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const pathname = usePathname();
    const contextualPlanId = extractPlanIdFromPathname(pathname) || readSelectedPlanCookie();

    // Close menu on route change (resize)
    useEffect(() => {
        const close = () => setMenuOpen(false);
        window.addEventListener('resize', close);
        return () => window.removeEventListener('resize', close);
    }, []);

    // Prevent body scroll when menu is open
    useEffect(() => {
        document.body.style.overflow = menuOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [menuOpen]);

    return (
        <header className="header">
            {!isSignedIn ? (
                <>
                    <Link className="brand" href="/">{brand}</Link>
                    <nav className="nav">
                        <Link href="/">Home</Link>
                    </nav>
                    <div style={{ marginLeft: 'auto' }}>
                        <Link className="cta secondary" href="/sign-in">Sign in</Link>
                    </div>
                </>
            ) : (
                <>
                    <Link className="brand" href={appendPlanQueryToHref(brandHref, contextualPlanId)}>{brand}</Link>
                    {roleChip && (
                        <span className={`env-chip ${roleChipClass || ''}`}>
                            {roleChip}
                        </span>
                    )}
                    <nav className="nav">
                        {isAccountInactive && (
                            <span className="nav-account-disabled">Account Deactivated</span>
                        )}
                        {!isAccountInactive && navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={appendPlanQueryToHref(item.href, contextualPlanId)}
                            >
                                {item.label}
                            </Link>
                        ))}
                        {!isAccountInactive && roleSwitchHref && (
                            <Link className="nav-role-switch" href={roleSwitchHref}>Switch Role</Link>
                        )}
                    </nav>

                    {/* Hamburger button — visible only on mobile via CSS */}
                    <button
                        className="hamburger-btn"
                        onClick={() => setMenuOpen(!menuOpen)}
                        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                    >
                        <span className={`hamburger-icon${menuOpen ? ' open' : ''}`}>
                            <span /><span /><span />
                        </span>
                    </button>

                    <div style={{ marginLeft: 'auto' }} className="header-user-btn">
                        <UserButton />
                    </div>
                </>
            )}

            {/* Mobile menu overlay */}
            {isSignedIn && menuOpen && (
                <>
                    <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />
                    <nav className="mobile-menu">
                        {!isAccountInactive && navItems.map((item) => (
                            <Link
                                key={item.href}
                                className="mobile-nav-link"
                                href={appendPlanQueryToHref(item.href, contextualPlanId)}
                                onClick={() => setMenuOpen(false)}
                            >
                                {item.label}
                            </Link>
                        ))}
                        {!isAccountInactive && roleSwitchHref && (
                            <Link
                                className="mobile-nav-link mobile-nav-role"
                                href={roleSwitchHref}
                                onClick={() => setMenuOpen(false)}
                            >
                                Switch Role
                            </Link>
                        )}
                    </nav>
                </>
            )}
        </header>
    );
}
