import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const email = user?.primaryEmailAddress?.emailAddress || '';
  const name = user?.fullName || user?.firstName || 'User';

  const dbUser = await prisma.user.upsert({
    where: { id: user.id },
    update: { email, name },
    create: { id: user.id, email, name, role: 'ATHLETE', currentRole: 'ATHLETE' }
  });

  return NextResponse.json(dbUser);
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: body.name,
      units: body.units,
      paceTargets: body.paceTargets,
      goalRaceDate: body.goalRaceDate ? new Date(body.goalRaceDate) : null,
      role: body.role || undefined,
      currentRole: body.role || undefined,
      hasBothRoles: body.hasBothRoles ?? undefined
    }
  });

  return NextResponse.json(updated);
}
