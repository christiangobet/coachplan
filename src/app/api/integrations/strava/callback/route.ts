import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { exchangeStravaCodeForAccount, syncStravaActivitiesForUser } from '@/lib/integrations/strava';
import { verifyIntegrationStateToken } from '@/lib/integrations/state';

function redirectToProfile(req: Request, params?: Record<string, string>) {
  const url = new URL('/profile', req.url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in', req.url));

  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const stateToken = url.searchParams.get('state');

  if (error) {
    return redirectToProfile(req, { integrationError: `strava_${error}` });
  }
  if (!code || !stateToken) {
    return redirectToProfile(req, { integrationError: 'strava_missing_code_or_state' });
  }

  const state = verifyIntegrationStateToken(stateToken, 15 * 60 * 1000);
  if (!state || state.provider !== 'STRAVA') {
    return redirectToProfile(req, { integrationError: 'strava_invalid_state' });
  }
  if (state.userId !== user.id) {
    return redirectToProfile(req, { integrationError: 'strava_state_mismatch' });
  }

  try {
    await exchangeStravaCodeForAccount({
      userId: user.id,
      code,
      origin: url.origin
    });
  } catch (exchangeError: unknown) {
    const message = exchangeError instanceof Error ? exchangeError.message : 'strava_exchange_failed';
    return redirectToProfile(req, { integrationError: message.slice(0, 120) });
  }

  try {
    await syncStravaActivitiesForUser({ userId: user.id, lookbackDays: 365 });
  } catch {
    return redirectToProfile(req, { integration: 'strava_connected', integrationWarning: 'sync_failed' });
  }

  return redirectToProfile(req, { integration: 'strava_connected' });
}
