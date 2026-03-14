// src/lib/plan-chat-ai.ts
// Core AI chat logic. Handles three triggers: athlete_message, drag_drop, edit_session_end.
// Uses openaiJsonSchema with single input string (no messages array).

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getDefaultAiModel, openaiJsonSchema } from '@/lib/openai';
import { buildPerformanceContext } from '@/lib/plan-performance-context';
import type { ChatMessage, MessageMetadata, DaySnapshot } from '@/lib/plan-chat-types';

async function getRecentMessages(planId: string, limit = 30) {
  const messages = await prisma.planChatMessage.findMany({
    where: { planId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return messages.reverse();
}

function serializeConversation(messages: Awaited<ReturnType<typeof getRecentMessages>>): string {
  if (messages.length === 0) return '';
  return '[CONVERSATION HISTORY]\n' + messages.map((m) => {
    const label = m.role === 'athlete' ? 'Athlete' : m.role === 'coach' ? 'Coach' : 'System';
    return `${label}: ${m.content}`;
  }).join('\n');
}

function toChatMessage(record: {
  id: string;
  planId: string;
  role: string;
  content: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): ChatMessage {
  return {
    id: record.id,
    planId: record.planId,
    role: record.role as ChatMessage['role'],
    content: record.content,
    metadata: record.metadata as MessageMetadata | null,
    createdAt: record.createdAt.toISOString(),
  };
}

async function supersedeActiveCoachMessages(planId: string) {
  const activeMessages = await prisma.planChatMessage.findMany({
    where: { planId, role: 'coach' },
    select: { id: true, metadata: true },
  });

  await Promise.all(
    activeMessages.map(async (msg) => {
      const meta = (msg.metadata as MessageMetadata | null) ?? {};
      if (meta.state === 'active') {
        await prisma.planChatMessage.update({
          where: { id: msg.id },
          data: { metadata: { ...meta, state: 'superseded' } },
        });
      }
    })
  );
}

export async function persistAiAdjustmentConversation(
  planId: string,
  args: {
    athleteContent: string;
    coachContent: string;
    coachMetadata?: MessageMetadata | null;
  }
) {
  await supersedeActiveCoachMessages(planId);

  const [athleteMessage, coachMessage] = await prisma.$transaction([
    prisma.planChatMessage.create({
      data: { planId, role: 'athlete', content: args.athleteContent },
    }),
    prisma.planChatMessage.create({
      data: {
        planId,
        role: 'coach',
        content: args.coachContent,
        metadata: (args.coachMetadata ?? { state: 'active' }) as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  return {
    athleteMessage: toChatMessage(athleteMessage),
    coachMessage: toChatMessage(coachMessage),
  };
}

export async function handleAthleteMessage(
  planId: string,
  content: string
): Promise<ChatMessage> {
  await supersedeActiveCoachMessages(planId);

  // Save athlete message
  await prisma.planChatMessage.create({
    data: { planId, role: 'athlete', content },
  });

  // Build context
  const [recentMessages, performanceContext] = await Promise.all([
    getRecentMessages(planId),
    buildPerformanceContext(planId),
  ]);

  const recentChanges = await prisma.planChangeLog.findMany({
    where: { planId, createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const changesContext = recentChanges.length > 0
    ? `[RECENT PLAN CHANGES]\n${recentChanges.map((c) => `  ${c.changeType} (${c.source}) — ${new Date(c.createdAt).toLocaleDateString()}`).join('\n')}`
    : '';

  const input = [
    '[SYSTEM] You are an experienced endurance running coach.',
    'Respond conversationally in 1-3 sentences. Be direct, practical, and athlete-friendly.',
    performanceContext ? `\n${performanceContext}` : '',
    changesContext ? `\n${changesContext}` : '',
    serializeConversation(recentMessages),
    `[ATHLETE REQUEST]\n${content}`,
  ].filter(Boolean).join('\n\n');

  const model = getDefaultAiModel();
  const result = await openaiJsonSchema<{ coachReply: string; followUpQuestion?: string }>({
    input,
    model,
    schema: {
      name: 'coach_reply',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          coachReply: { type: 'string' },
          followUpQuestion: { type: 'string' },
        },
        required: ['coachReply'],
        additionalProperties: false,
      },
    },
  });

  const replyContent = result.followUpQuestion
    ? `${result.coachReply}\n\n${result.followUpQuestion}`
    : result.coachReply;

  const metadata: MessageMetadata = { state: 'active' };
  const saved = await prisma.planChatMessage.create({
    data: { planId, role: 'coach', content: replyContent, metadata: metadata as unknown as Prisma.InputJsonValue },
  });
  return toChatMessage(saved);
}

export async function handleDragDrop(
  planId: string,
  changeLogIds: string[]
): Promise<ChatMessage | null> {
  if (changeLogIds.length === 0) return null;

  const changeLogs = await prisma.planChangeLog.findMany({
    where: { id: { in: changeLogIds }, planId },
  });
  if (changeLogs.length === 0) return null;

  const performanceContext = await buildPerformanceContext(planId);

  const changeDesc = changeLogs.map((c) => {
    const before = c.before as DaySnapshot | null;
    const after = c.after as DaySnapshot | null;
    const beforeActivities = before?.activities.map((a) => `${a.title} (${a.type})`).join(', ') || 'empty';
    const afterActivities = after?.activities.map((a) => `${a.title} (${a.type})`).join(', ') || 'empty';
    return `Activity "${c.activityId}" moved from day "${c.fromDayId}" (was: ${beforeActivities}) to day "${c.toDayId}" (now: ${afterActivities})`;
  }).join('\n');

  const input = [
    '[SYSTEM] You are an experienced endurance running coach observing plan edits.',
    'Analyse the session moves below.',
    'If you detect a REAL risk (back-to-back hard/quality sessions on consecutive days, 2+ quality sessions on one day, quality session in race week), write a SHORT coaching comment (50-120 words). Be conversational.',
    'If moves are safe (easy runs, rest days, cross-training), set risk to false.',
    'Quality session subtypes: tempo, hills, progression, training-race, race, fast-finish, hill-pyramid, incline-treadmill.',
    performanceContext ? `\n${performanceContext}` : '',
    `[PLAN CHANGES]\n${changeDesc}`,
  ].filter(Boolean).join('\n\n');

  const model = getDefaultAiModel();
  const result = await openaiJsonSchema<{ risk: boolean; comment?: string; followUp?: string }>({
    input,
    model,
    schema: {
      name: 'risk_assessment',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          risk: { type: 'boolean' },
          comment: { type: 'string' },
          followUp: { type: 'string' },
        },
        required: ['risk'],
        additionalProperties: false,
      },
    },
  });

  if (!result.risk || !result.comment) return null;

  const moveNote = changeLogs.length === 1 ? 'You moved a session' : `You moved ${changeLogs.length} sessions`;
  await prisma.planChatMessage.create({
    data: { planId, role: 'system', content: moveNote, metadata: { changeLogIds } as unknown as Prisma.InputJsonValue },
  });

  const replyContent = result.followUp ? `${result.comment}\n\n${result.followUp}` : result.comment;
  const saved = await prisma.planChatMessage.create({
    data: { planId, role: 'coach', content: replyContent, metadata: { state: 'active' } as unknown as Prisma.InputJsonValue },
  });
  return toChatMessage(saved);
}

export async function handleEditSessionEnd(
  planId: string,
  editSessionId: string
): Promise<ChatMessage | null> {
  const changes = await prisma.planChangeLog.findMany({
    where: { planId, editSessionId },
    orderBy: { createdAt: 'asc' },
  });
  if (changes.length === 0) return null;

  const performanceContext = await buildPerformanceContext(planId);
  const changeDesc = changes.map((c) => {
    const before = c.before as DaySnapshot | null;
    const after = c.after as DaySnapshot | null;
    const fromActs = before?.activities.map((a) => a.title).join(', ') || 'empty';
    const toActs = after?.activities.map((a) => a.title).join(', ') || 'empty';
    return `${c.changeType}: "${c.activityId ?? 'unknown'}" from "${c.fromDayId ?? '?'}" (${fromActs}) → "${c.toDayId ?? '?'}" (${toActs})`;
  }).join('\n');

  const input = [
    '[SYSTEM] You are an experienced endurance running coach.',
    'The athlete just finished editing their training plan. Summarise what was changed in 1-3 concise sentences (max 150 words).',
    'Be conversational and coaching-focused. Note implications for load, recovery, or upcoming races.',
    performanceContext ? `\n${performanceContext}` : '',
    `[SESSION CHANGES]\n${changeDesc}`,
  ].filter(Boolean).join('\n\n');

  const model = getDefaultAiModel();
  const result = await openaiJsonSchema<{ summary: string; followUp?: string }>({
    input,
    model,
    schema: {
      name: 'session_summary',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          followUp: { type: 'string' },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  });

  const content = result.followUp ? `${result.summary}\n\n${result.followUp}` : result.summary;
  const saved = await prisma.planChatMessage.create({
    data: { planId, role: 'coach', content, metadata: { state: 'active' } as unknown as Prisma.InputJsonValue },
  });
  return toChatMessage(saved);
}
