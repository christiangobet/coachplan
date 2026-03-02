import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET /api/admin/parser-prompts — list all prompts
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const prompts = await prisma.parserPrompt.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true, text: true }
  });

  const result = prompts.map(p => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    charCount: p.text.length,
    preview: p.text.slice(0, 200)
  }));

  return NextResponse.json(result);
}

// POST /api/admin/parser-prompts — create a new prompt
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, text, activate } = body as { name: string; text: string; activate?: boolean };

  if (!name || !text) {
    return NextResponse.json({ error: 'name and text are required' }, { status: 400 });
  }

  let prompt;
  if (activate) {
    prompt = await prisma.$transaction(async tx => {
      await tx.parserPrompt.updateMany({ data: { isActive: false } });
      return tx.parserPrompt.create({ data: { name, text, isActive: true } });
    });
  } else {
    prompt = await prisma.parserPrompt.create({ data: { name, text, isActive: false } });
  }

  return NextResponse.json(prompt, { status: 201 });
}
