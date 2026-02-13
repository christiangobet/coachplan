import { IntegrationProvider } from '@prisma/client';

export const ALL_INTEGRATION_PROVIDERS: IntegrationProvider[] = ['STRAVA', 'GARMIN'];

export function parseIntegrationProvider(value: string | null | undefined): IntegrationProvider | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'STRAVA') return 'STRAVA';
  if (normalized === 'GARMIN') return 'GARMIN';
  return null;
}

export function providerLabel(provider: IntegrationProvider): string {
  return provider === 'STRAVA' ? 'Strava' : 'Garmin';
}
