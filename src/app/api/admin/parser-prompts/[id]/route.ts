import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// PATCH /api/admin/parser-prompts/[id] — update name/text, or activate
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  if (body.activate) {
    const prompt = await prisma.$transaction(async tx => {
      await tx.parserPrompt.updateMany({ data: { isActive: false } });
      return tx.parserPrompt.update({ where: { id }, data: { isActive: true } });
    });
    return NextResponse.json(prompt);
  }

  const data: { name?: string; text?: string } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.text !== undefined) data.text = body.text;

  const prompt = await prisma.parserPrompt.update({ where: { id }, data });
  return NextResponse.json(prompt);
}

// DELETE /api/admin/parser-prompts/[id] — reject if active or only remaining
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const prompt = await prisma.parserPrompt.findUnique({ where: { id } });

  if (!prompt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (prompt.isActive) {
    return NextResponse.json({ error: 'Cannot delete the active prompt. Activate another prompt first.' }, { status: 409 });
  }

  const total = await prisma.parserPrompt.count();
  if (total <= 1) {
    return NextResponse.json({ error: 'Cannot delete the only remaining prompt.' }, { status: 409 });
  }

  await prisma.parserPrompt.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
