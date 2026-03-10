import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { getOrRefreshPerformanceSnapshotForUser } from '@/lib/performance-snapshot';

function toBoolean(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function toPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: Request) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dbUser = await ensureUserFromAuth(authUser, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  try {
    const url = new URL(req.url);
    const refresh = toBoolean(url.searchParams.get('refresh'));
    const lookbackDays = Math.min(toPositiveInt(url.searchParams.get('lookbackDays'), 84), 3650);

    const result = await getOrRefreshPerformanceSnapshotForUser({
      userId: dbUser.id,
      forceRefresh: refresh,
      lookbackDays
    });

    if (result.status === 'NEEDS_SYNC') {
      return NextResponse.json({
        status: 'needs_sync',
        snapshot: null,
        dataAvailableDays: result.dataAvailableDays,
        requestedDays: result.requestedDays
      });
    }
    if (result.status === 'DISCONNECTED') {
      return NextResponse.json({ status: 'disconnected', snapshot: null, reason: result.reason });
    }
    if (result.status === 'INSUFFICIENT_DATA') {
      return NextResponse.json({ status: 'insufficient_data', snapshot: null, reason: result.reason, cached: result.cached });
    }

    return NextResponse.json({ status: 'ready', snapshot: result.snapshot, cached: result.cached });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build performance snapshot';
    return NextResponse.json({ status: 'error', snapshot: null, reason: message }, { status: 500 });
  }
}
