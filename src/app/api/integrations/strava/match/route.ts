import { NextResponse } from 'next/server';
import { requireRoleApi } from '@/lib/role-guards';
import { setStravaActivityMatchForUser } from '@/lib/integrations/strava';

type MatchBody = {
  externalActivityId?: unknown;
  planActivityId?: unknown;
  applyActuals?: unknown;
};

export async function POST(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await req.json().catch(() => ({}))) as MatchBody;
  const externalActivityId = typeof body.externalActivityId === 'string' ? body.externalActivityId : '';
  const planActivityIdRaw = body.planActivityId;
  const applyActuals = body.applyActuals === undefined ? true : Boolean(body.applyActuals);

  if (!externalActivityId) {
    return NextResponse.json({ error: 'externalActivityId is required' }, { status: 400 });
  }

  const planActivityId = typeof planActivityIdRaw === 'string'
    ? (planActivityIdRaw.trim() || null)
    : null;

  try {
    await setStravaActivityMatchForUser({
      userId: access.context.userId,
      externalActivityId,
      planActivityId,
      applyActuals
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save Strava match';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
