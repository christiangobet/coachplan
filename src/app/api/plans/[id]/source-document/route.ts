import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      sourceDocument: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSize: true,
          pageCount: true,
          createdAt: true
        }
      }
    }
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!plan.sourceDocument) {
    return NextResponse.json({
      available: false
    });
  }

  return NextResponse.json({
    available: true,
    fileName: plan.sourceDocument.fileName,
    mimeType: plan.sourceDocument.mimeType,
    fileSize: plan.sourceDocument.fileSize,
    pageCount: plan.sourceDocument.pageCount,
    createdAt: plan.sourceDocument.createdAt.toISOString(),
    fileUrl: `/api/plans/${plan.id}/source-document/file`
  });
}
