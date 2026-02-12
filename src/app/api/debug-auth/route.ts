import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET() {
  const { userId, sessionId } = await auth();
  const user = await currentUser();

  return NextResponse.json({
    userId: userId ?? null,
    sessionId: sessionId ?? null,
    currentUserId: user?.id || null,
    email: user?.primaryEmailAddress?.emailAddress || null,
    name: user?.fullName || user?.firstName || null,
    hasClerkSecret: Boolean(process.env.CLERK_SECRET_KEY),
    hasClerkPublishable: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  });
}
