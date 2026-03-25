import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';

const ALLOWED_CHANGE_LOG_SOURCES = new Set([
  'manual_drag',
  'manual_edit',
  'ai_applied',
  'system',
]);

const ALLOWED_CHANGE_LOG_TYPES = new Set([
  'move_activity',
  'edit_activity',
  'add_activity',
  'delete_activity',
  'extend_plan',
  'reanchor_subtype_weekly',
]);

const MAX_CHANGE_LOG_JSON_BYTES = 16 * 1024;
const MAX_CHANGE_LOG_FIELD_LENGTH = 191;

function parseOptionalField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CHANGE_LOG_FIELD_LENGTH) {
    return undefined;
  }

  return trimmed;
}

function validateJsonPayload(
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;

  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') {
      throw new Error('Invalid JSON payload');
    }

    const byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (byteLength > MAX_CHANGE_LOG_JSON_BYTES) {
      throw new Error('JSON payload too large');
    }

    return JSON.parse(json) as Prisma.InputJsonValue;
  } catch (error) {
    if (error instanceof Error && error.message === 'JSON payload too large') {
      throw error;
    }
    throw new Error('Invalid JSON payload');
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, OR: [{ ownerId: user.id }, { athleteId: user.id }] },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as {
    source: string;
    changeType: string;
    activityId?: string;
    fromDayId?: string;
    toDayId?: string;
    editSessionId?: string;
    before?: unknown;
    after?: unknown;
  };

  const source = typeof body.source === 'string' ? body.source.trim() : '';
  if (!ALLOWED_CHANGE_LOG_SOURCES.has(source)) {
    return NextResponse.json({ error: 'Invalid change-log source' }, { status: 400 });
  }

  const changeType = typeof body.changeType === 'string' ? body.changeType.trim() : '';
  if (!ALLOWED_CHANGE_LOG_TYPES.has(changeType)) {
    return NextResponse.json({ error: 'Invalid change-log type' }, { status: 400 });
  }

  const activityId = parseOptionalField(body.activityId);
  const fromDayId = parseOptionalField(body.fromDayId);
  const toDayId = parseOptionalField(body.toDayId);
  const editSessionId = parseOptionalField(body.editSessionId);
  if (
    (body.activityId !== undefined && activityId === undefined)
    || (body.fromDayId !== undefined && fromDayId === undefined)
    || (body.toDayId !== undefined && toDayId === undefined)
    || (body.editSessionId !== undefined && editSessionId === undefined)
  ) {
    return NextResponse.json({ error: 'Invalid change-log field' }, { status: 400 });
  }

  let before: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
  let after: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
  try {
    before = validateJsonPayload(body.before);
    after = validateJsonPayload(body.after);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const entry = await prisma.planChangeLog.create({
    data: {
      planId,
      source,
      changeType,
      activityId,
      fromDayId,
      toDayId,
      editSessionId,
      before,
      after,
    }
  });

  return NextResponse.json({ id: entry.id });
}
