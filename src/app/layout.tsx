import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { ClerkProvider } from "@clerk/nextjs";
import { headers } from "next/headers";
import { getCurrentUserRoleContext, getRoleHomePath, getRoleLabel } from "@/lib/user-roles";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyTrainingPlan",
  description: "Upload training plans, align to race day, and track progress.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "MyTrainingPlan",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fc4c02",
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
      <head>
        {/* Required for iOS standalone / fullscreen PWA mode */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* iOS Splash Screens */}
        <link rel="apple-touch-startup-image" href="/splash/splash-640x1136.png"   media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-750x1334.png"   media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1242x2208.png"  media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1125x2436.png"  media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1242x2688.png"  media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-828x1792.png"   media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1170x2532.png"  media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1284x2778.png"  media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1080x2340.png"  media="(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1179x2556.png"  media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1290x2796.png"  media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1488x2266.png"  media="(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1536x2048.png"  media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/splash-2048x2732.png"  media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
      </head>
      <body>
        <ServiceWorkerRegistration />
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
