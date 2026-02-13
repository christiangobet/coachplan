import { NextResponse } from 'next/server';
import { getAdminStats } from '@/lib/admin';
import { requireRoleApi } from '@/lib/role-guards';

export async function GET() {
  const access = await requireRoleApi('ADMIN');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const stats = await getAdminStats();
  return NextResponse.json({ stats });
}
