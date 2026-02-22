import type { Metadata } from "next";
import { UserRole } from "@prisma/client";
import { ClerkProvider } from "@clerk/nextjs";
import { getCurrentUserRoleContext, getRoleHomePath, getRoleLabel } from "@/lib/user-roles";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Training Plan",
  description: "Upload training plans, align to race day, and track progress.",
};

type TopNavItem = { href: string; label: string };

function navItemsForRole(role: UserRole): TopNavItem[] {
  if (role === "COACH") {
    return [
      { href: "/coach", label: "Coach" },
      { href: "/plans", label: "Plans Management" },
      { href: "/profile", label: "Profile" }
    ];
  }

  if (role === "ADMIN") {
    return [{ href: "/admin", label: "Admin" }];
  }

  return [
    { href: "/dashboard", label: "Today" },
    { href: "/calendar", label: "Training Calendar" },
    { href: "/strava", label: "Import Strava" },
    { href: "/progress", label: "Progress" },
    { href: "/plans", label: "Plans Management" },
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
  const roleContext = await getCurrentUserRoleContext();
  const currentRole = roleContext?.currentRole || "ATHLETE";
  const isAccountInactive = !!(roleContext && !roleContext.isActive);
  const navItems = isAccountInactive ? [] : navItemsForRole(currentRole);
  const hasMultiRole = !isAccountInactive && (roleContext?.availableRoles.length || 0) > 1;
  const signedInHome = roleContext && !isAccountInactive
    ? getRoleHomePath(currentRole)
    : "/auth/resolve-role";
  const isSignedIn = !!roleContext;
  const content = (
    <html lang="en">
      <body>
        <Header
          brand="CoachPlan"
          brandHref={signedInHome}
          roleChip={isSignedIn ? getRoleLabel(currentRole) : undefined}
          roleChipClass={isSignedIn ? `env-chip-${currentRole.toLowerCase()}` : undefined}
          navItems={navItems}
          roleSwitchHref={hasMultiRole ? "/select-role" : null}
          isSignedIn={isSignedIn}
          isAccountInactive={isAccountInactive}
        />
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
