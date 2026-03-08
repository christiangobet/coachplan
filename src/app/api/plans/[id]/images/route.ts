import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import {
  PLAN_IMAGE_MAX_COUNT,
  PLAN_IMAGE_MAX_FILE_BYTES,
  resolvePlanImageMime,
} from '@/lib/plan-banner';

async function resolveAccessiblePlan(planId: string, userId: string) {
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      bannerImageId: true,
    },
  });
  if (!plan) return { error: 'Not found', status: 404 as const };
  if (plan.ownerId !== userId && plan.athleteId !== userId) {
    return { error: 'Forbidden', status: 403 as const };
  }
  return { plan };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const access = await resolveAccessiblePlan(id, user.id);
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const images = await prisma.planImage.findMany({
    where: { planId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    selectedImageId: access.plan.bannerImageId ?? null,
    maxImages: PLAN_IMAGE_MAX_COUNT,
    maxFileBytes: PLAN_IMAGE_MAX_FILE_BYTES,
    images: images.map((image) => ({
      id: image.id,
      fileName: image.fileName,
      mimeType: image.mimeType,
      fileSize: image.fileSize,
      createdAt: image.createdAt.toISOString(),
      isSelected: image.id === access.plan.bannerImageId,
      url: `/api/plans/${id}/images/${image.id}/file`,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const access = await resolveAccessiblePlan(id, user.id);
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const form = await req.formData();
  const incoming = form.get('file');
  if (!(incoming instanceof File)) {
    return NextResponse.json({ error: 'Image file is required' }, { status: 400 });
  }
  if (incoming.size <= 0) {
    return NextResponse.json({ error: 'Image file is empty' }, { status: 400 });
  }
  if (incoming.size > PLAN_IMAGE_MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `Image exceeds ${Math.round(PLAN_IMAGE_MAX_FILE_BYTES / (1024 * 1024))}MB limit` },
      { status: 400 }
    );
  }

  const mimeType = resolvePlanImageMime({
    mimeType: incoming.type,
    fileName: incoming.name,
  });
  if (!mimeType) {
    return NextResponse.json({ error: 'Only JPG, PNG, WEBP, and AVIF are allowed' }, { status: 400 });
  }

  const existingCount = await prisma.planImage.count({ where: { planId: id } });
  if (existingCount >= PLAN_IMAGE_MAX_COUNT) {
    return NextResponse.json({ error: `Maximum ${PLAN_IMAGE_MAX_COUNT} images per plan` }, { status: 400 });
  }

  const buffer = Buffer.from(await incoming.arrayBuffer());
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.planImage.create({
      data: {
        planId: id,
        fileName: incoming.name || null,
        mimeType,
        fileSize: incoming.size,
        content: buffer,
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
      },
    });

    let selectedImageId = access.plan.bannerImageId ?? null;
    if (!selectedImageId) {
      await tx.trainingPlan.update({
        where: { id },
        data: { bannerImageId: created.id },
      });
      selectedImageId = created.id;
    }

    return { created, selectedImageId };
  });

  return NextResponse.json({
    selectedImageId: result.selectedImageId,
    image: {
      id: result.created.id,
      fileName: result.created.fileName,
      mimeType: result.created.mimeType,
      fileSize: result.created.fileSize,
      createdAt: result.created.createdAt.toISOString(),
      isSelected: result.created.id === result.selectedImageId,
      url: `/api/plans/${id}/images/${result.created.id}/file`,
    },
  });
}
