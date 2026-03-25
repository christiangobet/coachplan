import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireRoleApi } from "@/lib/role-guards";

export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_AUTH_ROUTE_ENABLED !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await requireRoleApi('ADMIN');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { userId, sessionId } = await auth();

  return NextResponse.json({
    userId: userId ?? null,
    sessionId: sessionId ?? null,
    role: access.context.currentRole,
    hasClerkSecret: Boolean(process.env.CLERK_SECRET_KEY),
  });
}
