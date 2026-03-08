import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { isAllowedPlanImageMime } from '@/lib/plan-banner';

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || 'plan-banner';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, imageId } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: { ownerId: true, athleteId: true },
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const image = await prisma.planImage.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      planId: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      content: true,
    },
  });
  if (!image || image.planId !== id) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  const mimeType = isAllowedPlanImageMime(image.mimeType) ? image.mimeType : 'application/octet-stream';
  const fileName = sanitizeFileName(image.fileName || `${image.id}`);
  const payload = new Uint8Array(image.content as unknown as Buffer);

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(image.fileSize),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
