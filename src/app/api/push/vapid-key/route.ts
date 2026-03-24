import { NextResponse } from "next/server";

export async function GET() {
  const { getServerVapidPublicKey } = await import("@/lib/push-server");

  return NextResponse.json({ publicKey: getServerVapidPublicKey() });
}
