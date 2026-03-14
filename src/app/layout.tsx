import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { ClerkProvider } from "@clerk/nextjs";
import { headers } from "next/headers";
import { getCurrentUserRoleContext, getRoleHomePath, getRoleLabel } from "@/lib/user-roles";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyTrainingPlan",
  description: "Upload training plans, align to race day, and track progress.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

type TopNavItem = { href: string; label: string; planOnly?: boolean };
const SHELLLESS_PREFIXES = ['/sign-in', '/sign-up', '/auth/resolve-role', '/select-role'];
const PUBLIC_SHELLLESS_PATHS = new Set(['/', '/privacy', '/terms']);

function shouldSkipRoleResolution(pathname: string) {
  if (!pathname) return false;
  if (PUBLIC_SHELLLESS_PATHS.has(pathname)) return true;
  return SHELLLESS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function navItemsForRole(role: UserRole): TopNavItem[] {
  if (role === "COACH") {
    return [
      { href: "/coach", label: "Coach" },
      { href: "/plans", label: "Plans Library" },
      { href: "/profile", label: "Profile" }
    ];
  }

  if (role === "ADMIN") {
    return [{ href: "/admin", label: "Admin" }];
  }

  return [
    { href: "/dashboard", label: "Today" },
    { href: "/calendar", label: "Training Calendar" },
    { href: "/plans/:planId", label: "Plan by Week", planOnly: true },
    { href: "/strava", label: "Import Strava" },
    { href: "/progress", label: "Progress" },
    { href: "/plans", label: "Plans Library" },
    { href: "/profile", label: "Profile" }
  ];
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hasClerkEnv = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  );
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";
  const skipRoleResolution = shouldSkipRoleResolution(pathname);
  const isLandingPage = pathname === "/";
  const roleContext = skipRoleResolution ? null : await getCurrentUserRoleContext();
  const currentRole = roleContext?.currentRole || "ATHLETE";
  const isAccountInactive = !!(roleContext && !roleContext.isActive);
  const navItems = isAccountInactive ? [] : navItemsForRole(currentRole);
  const hasMultiRole = !isAccountInactive && (roleContext?.availableRoles.length || 0) > 1;
  const signedInHome = roleContext && !isAccountInactive
    ? getRoleHomePath(currentRole)
    : "/auth/resolve-role";
  const isSignedIn = !!roleContext;
  const showAppChrome = !skipRoleResolution && !isLandingPage;
  const content = (
    <html lang="en" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');})();` }} />
      <body>
        {showAppChrome && (
          <Header
            brand="MyTrainingPlan"
            brandHref={signedInHome}
            roleChip={isSignedIn ? getRoleLabel(currentRole) : undefined}
            roleChipClass={isSignedIn ? `env-chip-${currentRole.toLowerCase()}` : undefined}
            navItems={navItems}
            roleSwitchHref={hasMultiRole ? "/select-role" : null}
            isSignedIn={isSignedIn}
            isAccountInactive={isAccountInactive}
          />
        )}
        {isAccountInactive ? (
          <main className="account-disabled-shell">
            <section className="account-disabled-card">
              <h1>Account Deactivated</h1>
              <p>
                Your account is currently deactivated. Contact an administrator to reactivate access.
              </p>
            </section>
          </main>
        ) : (
          children
        )}
        {showAppChrome && !isAccountInactive && (
          <Suspense fallback={null}>
            <MobileNav />
          </Suspense>
        )}
      </body>
    </html>
  );

  if (!hasClerkEnv) {
    return content;
  }

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/auth/resolve-role"
      afterSignUpUrl="/auth/resolve-role"
    >
      {content}
    </ClerkProvider>
  );
}
