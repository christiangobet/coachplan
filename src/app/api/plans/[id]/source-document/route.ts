import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { resolveSourceDocument } from '@/lib/resolve-source-document';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: { id: true, ownerId: true, athleteId: true }
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const resolved = await resolveSourceDocument(id);

  if (!resolved) {
    return NextResponse.json({ available: false });
  }

  const { doc } = resolved;
  return NextResponse.json({
    available: true,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    pageCount: doc.pageCount,
    createdAt: doc.createdAt.toISOString(),
    fileUrl: `/api/plans/${id}/source-document/file`
  });
}
