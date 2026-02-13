import { NextResponse } from 'next/server';
import { requireRoleApi } from '@/lib/role-guards';

export async function POST() {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  return NextResponse.json(
    {
      error: 'Garmin integration requires Garmin Health API partner credentials and is not enabled yet.',
      status: 'NOT_CONFIGURED'
    },
    { status: 501 }
  );
}
