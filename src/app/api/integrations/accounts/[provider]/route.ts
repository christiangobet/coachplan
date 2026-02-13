import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';
import { parseIntegrationProvider } from '@/lib/integrations/providers';
import { disconnectStravaForUser } from '@/lib/integrations/strava';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const access = await requireRoleApi('ATHLETE');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { provider: rawProvider } = await params;
  const provider = parseIntegrationProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  if (provider === 'STRAVA') {
    const result = await disconnectStravaForUser(access.context.userId);
    return NextResponse.json({
      provider,
      deleted: result.deletedLocalAccount,
      revokedAtStrava: result.revokedAtStrava
    });
  }

  const deleted = await prisma.externalAccount.deleteMany({
    where: {
      userId: access.context.userId,
      provider
    }
  });

  return NextResponse.json({ deleted: deleted.count > 0, provider });
}
