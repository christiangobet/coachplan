import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRoleApi } from '@/lib/role-guards';
import { importStravaDayForUser } from '@/lib/integrations/strava';
import { SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';

type ImportDayBody = {
  date?: unknown;
  planId?: unknown;
};

export async function POST(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const cookieStore = await cookies();
  const cookiePlanId = cookieStore.get(SELECTED_PLAN_COOKIE)?.value || null;

  const body = (await req.json().catch(() => ({}))) as ImportDayBody;
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const preferredPlanId = typeof body.planId === 'string' && body.planId.trim()
    ? body.planId.trim()
    : cookiePlanId;
  if (!date) {
    return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const summary = await importStravaDayForUser({
      userId: access.context.userId,
      date,
      preferredPlanId
    });
    return NextResponse.json({ summary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to import day from Strava';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
