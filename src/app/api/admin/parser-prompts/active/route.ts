import { NextResponse } from 'next/server';
import { requireRoleApi } from '@/lib/role-guards';
import { prisma } from '@/lib/prisma';

// GET /api/admin/parser-prompts/active — return full text of the active prompt
export async function GET() {
  const access = await requireRoleApi('ADMIN');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const prompt = await prisma.parserPrompt.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, text: true, updatedAt: true }
  });

  if (!prompt) return NextResponse.json({ error: 'No active prompt' }, { status: 404 });

  return NextResponse.json({
    id:        prompt.id,
    name:      prompt.name,
    text:      prompt.text,
    updatedAt: prompt.updatedAt,
  });
}
