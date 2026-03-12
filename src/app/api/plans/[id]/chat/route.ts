import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import type { ChatMessage } from '@/lib/plan-chat-types';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;
  const clerkUser = await currentUser();
  if (!clerkUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(clerkUser);

  const plan = await prisma.trainingPlan.findFirst({
    where: {
      id: planId,
      OR: [{ ownerId: user.id }, { athleteId: user.id }]
    },
    select: { id: true }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);

  const messages = await prisma.planChatMessage.findMany({
    where: { planId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const result: ChatMessage[] = messages.map((m) => ({
    id: m.id,
    planId: m.planId,
    role: m.role as ChatMessage['role'],
    content: m.content,
    metadata: m.metadata as ChatMessage['metadata'],
    createdAt: m.createdAt.toISOString(),
  }));

  return NextResponse.json({ messages: result });
}
