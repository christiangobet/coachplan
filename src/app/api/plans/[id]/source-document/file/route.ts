import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { resolveSourceDocument } from '@/lib/resolve-source-document';

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || 'plan.pdf';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: { ownerId: true, athleteId: true }
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const resolved = await resolveSourceDocument(id, true);

  if (!resolved) {
    return NextResponse.json({ error: 'Source document not found' }, { status: 404 });
  }

  const { doc } = resolved;
  const mimeType = doc.mimeType || 'application/pdf';
  const fileName = sanitizeFileName(doc.fileName || `${id}.pdf`);
  const payload = new Uint8Array(doc.content as unknown as Buffer);

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(doc.fileSize),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, max-age=300'
    }
  });
}
