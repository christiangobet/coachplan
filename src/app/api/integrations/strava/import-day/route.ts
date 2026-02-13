import { NextResponse } from 'next/server';
import { requireRoleApi } from '@/lib/role-guards';
import { importStravaDayForUser } from '@/lib/integrations/strava';

type ImportDayBody = {
  date?: unknown;
};

export async function POST(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await req.json().catch(() => ({}))) as ImportDayBody;
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!date) {
    return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const summary = await importStravaDayForUser({
      userId: access.context.userId,
      date
    });
    return NextResponse.json({ summary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to import day from Strava';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
