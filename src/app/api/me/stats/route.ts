// src/app/api/me/stats/route.ts
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dbUser = await ensureUserFromAuth(user, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  const [totalPlans, completedSessions, activeWeeks] = await Promise.all([
    prisma.trainingPlan.count({
      where: { athleteId: dbUser.id, isTemplate: false }
    }),
    prisma.planActivity.count({
      where: { plan: { athleteId: dbUser.id }, completed: true }
    }),
    prisma.planWeek.count({
      where: {
        plan: { athleteId: dbUser.id },
        days: { some: { activities: { some: { completed: true } } } }
      }
    })
  ]);

  return NextResponse.json({ totalPlans, completedSessions, activeWeeks });
}
