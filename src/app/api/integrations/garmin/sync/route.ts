import { NextResponse } from 'next/server';
import { requireRoleApi } from '@/lib/role-guards';

export async function POST() {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  return NextResponse.json(
    {
      error: 'Garmin sync is not enabled yet. Configure Garmin Health API credentials first.',
      status: 'NOT_CONFIGURED'
    },
    { status: 501 }
  );
}
