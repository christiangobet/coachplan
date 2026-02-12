import type { Metadata } from "next";
import { ClerkProvider, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Training Plan",
  description: "Upload training plans, align to race day, and track progress.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/dashboard"
      afterSignUpUrl="/dashboard"
    >
      <html lang="en">
        <body>
          <header className="header">
            <SignedOut>
              <div className="brand">Training Plan</div>
              <nav className="nav">
                <a href="/">Home</a>
              </nav>
              <div style={{ marginLeft: "auto" }}>
                <a className="cta secondary" href="/sign-in">Sign in</a>
              </div>
            </SignedOut>
            <SignedIn>
              <a className="brand" href="/dashboard">CoachPlan</a>
              <nav className="nav">
                <a href="/dashboard">Dashboard</a>
                <a href="/plans">Plans</a>
                <a href="/upload">Upload</a>
                <a href="/profile">Profile</a>
                <a href="/coach">Coach</a>
              </nav>
              <div style={{ marginLeft: "auto" }}>
                <UserButton />
              </div>
            </SignedIn>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
