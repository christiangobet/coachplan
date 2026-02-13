import type { Metadata } from "next";
import { UserRole } from "@prisma/client";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { getCurrentUserRoleContext, getRoleHomePath, getRoleLabel } from "@/lib/user-roles";
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
      { href: "/plans", label: "Plans" },
      { href: "/profile", label: "Profile" }
    ];
  }

  if (role === "ADMIN") {
    return [{ href: "/admin", label: "Admin" }];
  }

  return [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/calendar", label: "Calendar" },
    { href: "/progress", label: "Progress" },
    { href: "/plans", label: "Plans" },
    { href: "/upload", label: "Upload" },
    { href: "/profile", label: "Profile" }
  ];
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const roleContext = await getCurrentUserRoleContext();
  const currentRole = roleContext?.currentRole || "ATHLETE";
  const isAccountInactive = !!(roleContext && !roleContext.isActive);
  const navItems = isAccountInactive ? [] : navItemsForRole(currentRole);
  const hasMultiRole = !isAccountInactive && (roleContext?.availableRoles.length || 0) > 1;
  const signedInHome = roleContext && !isAccountInactive
    ? getRoleHomePath(currentRole)
    : "/auth/resolve-role";

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/auth/resolve-role"
      afterSignUpUrl="/auth/resolve-role"
    >
      <html lang="en">
        <body>
          <header className="header">
            <SignedOut>
              <Link className="brand" href="/">CoachPlan</Link>
              <nav className="nav">
                <Link href="/">Home</Link>
              </nav>
              <div style={{ marginLeft: "auto" }}>
                <Link className="cta secondary" href="/sign-in">Sign in</Link>
              </div>
            </SignedOut>
            <SignedIn>
              <Link className="brand" href={signedInHome}>CoachPlan</Link>
              <span className={`env-chip env-chip-${currentRole.toLowerCase()}`}>
                {getRoleLabel(currentRole)}
              </span>
              <nav className="nav">
                {isAccountInactive && (
                  <span className="nav-account-disabled">Account Deactivated</span>
                )}
                {!isAccountInactive && navItems.map((item) => (
                  <Link key={item.href} href={item.href}>{item.label}</Link>
                ))}
                {!isAccountInactive && hasMultiRole && (
                  <Link className="nav-role-switch" href="/select-role">Switch Role</Link>
                )}
              </nav>
              <div style={{ marginLeft: "auto" }}>
                <UserButton />
              </div>
            </SignedIn>
          </header>
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
    </ClerkProvider>
  );
}
