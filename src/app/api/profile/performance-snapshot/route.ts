import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { getOrRefreshPerformanceSnapshotForUser } from '@/lib/performance-snapshot';

function toBoolean(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
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
    const result = await getOrRefreshPerformanceSnapshotForUser({
      userId: dbUser.id,
      forceRefresh: refresh
    });

    if (result.status === 'DISCONNECTED') {
      return NextResponse.json({
        status: 'disconnected',
        snapshot: null,
        reason: result.reason
      });
    }
    if (result.status === 'INSUFFICIENT_DATA') {
      return NextResponse.json({
        status: 'insufficient_data',
        snapshot: null,
        reason: result.reason,
        cached: result.cached
      });
    }
    if (result.status === 'NEEDS_SYNC') {
      return NextResponse.json({
        status: 'needs_sync',
        snapshot: null,
        dataAvailableDays: result.dataAvailableDays,
        requestedDays: result.requestedDays
      });
    }

    return NextResponse.json({
      status: 'ready',
      snapshot: result.snapshot,
      cached: result.cached
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build performance snapshot';
    return NextResponse.json(
      { status: 'error', snapshot: null, reason: message },
      { status: 500 }
    );
  }
}
