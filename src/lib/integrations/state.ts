import { createHmac, timingSafeEqual } from 'crypto';
import { IntegrationProvider } from '@prisma/client';

type IntegrationStatePayload = {
  userId: string;
  provider: IntegrationProvider;
  issuedAt: number;
};

function getStateSecret() {
  const secret = process.env.INTEGRATIONS_STATE_SECRET || process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new Error('INTEGRATIONS_STATE_SECRET or CLERK_SECRET_KEY must be configured');
  }
  return secret;
}

function sign(encodedPayload: string) {
  return createHmac('sha256', getStateSecret()).update(encodedPayload).digest('base64url');
}

export function createIntegrationStateToken(payload: IntegrationStatePayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyIntegrationStateToken(token: string, maxAgeMs: number): IntegrationStatePayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as IntegrationStatePayload;
  if (!payload?.userId || !payload?.provider || !payload?.issuedAt) return null;

  if (Date.now() - payload.issuedAt > maxAgeMs) return null;
  return payload;
}
