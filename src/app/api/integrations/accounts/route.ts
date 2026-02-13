import { NextResponse } from 'next/server';
import { IntegrationProvider } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';
import { ALL_INTEGRATION_PROVIDERS } from '@/lib/integrations/providers';
import { isStravaConfigured } from '@/lib/integrations/strava';

type AccountPayload = {
  provider: IntegrationProvider;
  connected: boolean;
  isActive: boolean;
  providerUsername: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  expiresAt: string | null;
};

export async function GET() {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const accounts = await prisma.externalAccount.findMany({
    where: { userId: access.context.userId },
    select: {
      provider: true,
      isActive: true,
      providerUsername: true,
      connectedAt: true,
      lastSyncAt: true,
      expiresAt: true
    }
  });

  const byProvider = new Map(accounts.map((account) => [account.provider, account]));
  const payload: AccountPayload[] = ALL_INTEGRATION_PROVIDERS.map((provider) => {
    const account = byProvider.get(provider);
    return {
      provider,
      connected: Boolean(account),
      isActive: account?.isActive ?? false,
      providerUsername: account?.providerUsername ?? null,
      connectedAt: account?.connectedAt?.toISOString() ?? null,
      lastSyncAt: account?.lastSyncAt?.toISOString() ?? null,
      expiresAt: account?.expiresAt?.toISOString() ?? null
    };
  });

  return NextResponse.json({
    accounts: payload,
    capability: {
      stravaConfigured: isStravaConfigured(),
      garminConfigured: Boolean(process.env.GARMIN_CLIENT_ID && process.env.GARMIN_CLIENT_SECRET)
    }
  });
}
