import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const all = cookieStore.getAll().map((c) => c.name);
  return NextResponse.json({ cookies: all });
}
