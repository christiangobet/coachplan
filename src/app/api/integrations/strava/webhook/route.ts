import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type StravaWebhookPayload = {
  object_type?: string;
  aspect_type?: string;
  owner_id?: number;
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
    return NextResponse.json({ received: true });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ received: true });
  }

  if (shouldDeactivateStravaAccount(payload) && payload.owner_id) {
    await prisma.externalAccount.updateMany({
      where: {
        provider: 'STRAVA',
        providerUserId: String(payload.owner_id)
      },
      data: {
        isActive: false,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        syncCursor: null
      }
    });
  }

  return NextResponse.json({ received: true });
}
