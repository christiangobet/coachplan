import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

type StravaWebhookPayload = {
  object_type?: string;
  aspect_type?: string;
  owner_id?: number;
  subscription_id?: number;
  event_time?: number;
  updates?: Record<string, unknown>;
};

function getWebhookVerifyToken() {
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || '';
}

function shouldDeactivateStravaAccount(payload: StravaWebhookPayload) {
  if (payload.object_type !== 'athlete') return false;
  if (payload.aspect_type === 'delete') return true;
  if (payload.aspect_type !== 'update') return false;
  return String(payload.updates?.authorized || '').toLowerCase() === 'false';
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const expectedToken = getWebhookVerifyToken();

  if (!expectedToken) {
    return NextResponse.json({ error: 'STRAVA_WEBHOOK_VERIFY_TOKEN is not configured' }, { status: 503 });
  }
  if (mode !== 'subscribe' || !challenge) {
    return NextResponse.json({ error: 'Invalid webhook verification request' }, { status: 400 });
  }
  if (verifyToken !== expectedToken) {
    return NextResponse.json({ error: 'Invalid verify token' }, { status: 403 });
  }

  return NextResponse.json({ 'hub.challenge': challenge });
}

export async function POST(req: Request) {
  let payload: StravaWebhookPayload | null = null;
  try {
    payload = (await req.json()) as StravaWebhookPayload;
  } catch {
    // Malformed JSON — acknowledge to prevent Strava retries
    return NextResponse.json({ received: true });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ received: true });
  }

  // Validate subscription_id if configured — rejects spoofed events from other apps
  const expectedSubscriptionId = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID
    ? parseInt(process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID, 10)
    : null;
  if (expectedSubscriptionId !== null && payload.subscription_id !== expectedSubscriptionId) {
    logger.warn({ subscription_id: payload.subscription_id }, '[strava-webhook] rejected: unexpected subscription_id');
    return new Response('Forbidden', { status: 403 });
  }

  // owner_id must be a positive integer
  if (!payload.owner_id || typeof payload.owner_id !== 'number' || payload.owner_id <= 0) {
    return NextResponse.json({ received: true });
  }

  // Log all incoming events with timestamps for audit trail (required for Strava extended API)
  logger.info(
    {
      object_type: payload.object_type,
      aspect_type: payload.aspect_type,
      owner_id: payload.owner_id,
      subscription_id: payload.subscription_id,
      event_time: payload.event_time,
      receivedAt: new Date().toISOString()
    },
    '[strava-webhook] event received'
  );

  if (shouldDeactivateStravaAccount(payload)) {
    try {
      const result = await prisma.externalAccount.updateMany({
        where: {
          provider: 'STRAVA',
          providerUserId: String(payload.owner_id),
          isActive: true  // idempotent: no-op if already deactivated
        },
        data: {
          isActive: false,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          syncCursor: null
        }
      });
      logger.info(
        { owner_id: payload.owner_id, updatedCount: result.count },
        '[strava-webhook] deactivated strava account'
      );
    } catch (err) {
      // Log error but still return 200 — prevents Strava from unsubscribing the webhook on transient DB failures
      logger.error({ owner_id: payload.owner_id, err }, '[strava-webhook] DB write failed for deactivation');
    }
  }

  return NextResponse.json({ received: true });
}
