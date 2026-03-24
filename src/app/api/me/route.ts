import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

function validHour(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : undefined;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await ensureUserFromAuth(user, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  return NextResponse.json(dbUser);
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await ensureUserFromAuth(user, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });
  const body = await req.json();
  const updated = await prisma.user.update({
    where: { id: dbUser.id },
    data: {
      name: body.name,
      units: body.units,
      paceTargets: body.paceTargets,
      // Only set null when goalRaceDate is explicitly provided and falsy — not when absent
      goalRaceDate: body.goalRaceDate !== undefined
        ? (body.goalRaceDate ? new Date(body.goalRaceDate) : null)
        : undefined,
      role: body.role || undefined,
      currentRole: body.role || undefined,
      hasBothRoles: body.hasBothRoles ?? undefined,
      notifPrevDayHour:    validHour(body.notifPrevDayHour),
      notifSameDayEnabled: typeof body.notifSameDayEnabled === 'boolean' ? body.notifSameDayEnabled : undefined,
      notifSameDayHour:    validHour(body.notifSameDayHour),
    }
  });

  return NextResponse.json(updated);
}
