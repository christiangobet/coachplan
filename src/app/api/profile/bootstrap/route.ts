import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { ALL_INTEGRATION_PROVIDERS } from '@/lib/integrations/providers';
import { isStravaConfigured } from '@/lib/integrations/strava';
import { SAFE_USER_RESPONSE_SELECT } from '@/lib/safe-user-response';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dbUser = await ensureUserFromAuth(user, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE'
  });

  const [safeUser, coaches, totalPlans, completedSessions, activeWeeks, accounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: dbUser.id },
      select: SAFE_USER_RESPONSE_SELECT
    }),
    prisma.user.findMany({
      where: { role: 'COACH' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true }
    }),
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
    }),
    prisma.externalAccount.findMany({
      where: { userId: dbUser.id },
      select: {
        provider: true,
        isActive: true,
        providerUsername: true,
        connectedAt: true,
        lastSyncAt: true,
        expiresAt: true
      }
    })
  ]);

  const byProvider = new Map(accounts.map((account) => [account.provider, account]));

  return NextResponse.json({
    user: safeUser,
    coaches,
    stats: {
      totalPlans,
      completedSessions,
      activeWeeks
    },
    integrations: {
      accounts: ALL_INTEGRATION_PROVIDERS.map((provider) => {
        const account = byProvider.get(provider);
        return {
          provider,
          connected: Boolean(account?.isActive),
          isActive: account?.isActive ?? false,
          providerUsername: account?.providerUsername ?? null,
          connectedAt: account?.connectedAt?.toISOString() ?? null,
          lastSyncAt: account?.lastSyncAt?.toISOString() ?? null,
          expiresAt: account?.expiresAt?.toISOString() ?? null
        };
      }),
      capability: {
        stravaConfigured: isStravaConfigured(),
        garminConfigured: Boolean(process.env.GARMIN_CLIENT_ID && process.env.GARMIN_CLIENT_SECRET)
      }
    }
  });
}
