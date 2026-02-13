import { NextResponse } from 'next/server';
import { requireRoleApi } from '@/lib/role-guards';
import { buildStravaAuthorizeUrl, isStravaConfigured } from '@/lib/integrations/strava';

export async function POST(req: Request) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!isStravaConfigured()) {
    return NextResponse.json(
      { error: 'Strava integration is not configured on the server' },
      { status: 503 }
    );
  }

  const origin = new URL(req.url).origin;
  const url = buildStravaAuthorizeUrl(access.context.userId, origin);
  return NextResponse.json({ url });
}
