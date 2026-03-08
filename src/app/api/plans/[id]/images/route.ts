import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  PLAN_IMAGE_MAX_COUNT,
  PLAN_IMAGE_MAX_FILE_BYTES,
  resolvePlanImageMime,
} from '@/lib/plan-banner';

function isSchemaError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2021' || error.code === 'P2022';
}

function normalizeFocusY(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return 0.5;
}

async function resolveAccessiblePlan(planId: string, userId: string) {
  let schemaReady = true;
  let plan:
    | {
      id: string;
      ownerId: string | null;
      athleteId: string | null;
      bannerImageId: string | null;
    }
    | null = null;
  try {
    plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        ownerId: true,
        athleteId: true,
        bannerImageId: true,
      },
    });
  } catch (error) {
    if (!isSchemaError(error)) throw error;
    schemaReady = false;
    const fallback = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        ownerId: true,
        athleteId: true,
      },
    });
    if (fallback) {
      plan = {
        ...fallback,
        bannerImageId: null,
      };
    }
  }
  if (!plan) return { error: 'Not found', status: 404 as const };
  if (plan.ownerId !== userId && plan.athleteId !== userId) {
    return { error: 'Forbidden', status: 403 as const };
  }
  return { plan, schemaReady };
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

  let images: Array<{
    id: string;
    fileName: string | null;
    mimeType: string;
    fileSize: number;
    focusY: number;
    createdAt: Date;
  }> = [];
  let schemaReady = access.schemaReady;
  try {
    images = await prisma.planImage.findMany({
      where: { planId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        focusY: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (!isSchemaError(error)) throw error;
    schemaReady = false;
    images = [];
  }

  return NextResponse.json({
    selectedImageId: access.plan.bannerImageId ?? null,
    maxImages: PLAN_IMAGE_MAX_COUNT,
    maxFileBytes: PLAN_IMAGE_MAX_FILE_BYTES,
    schemaReady,
    warning: schemaReady ? null : 'Banner library is unavailable until database migrations are applied.',
    images: images.map((image) => ({
      id: image.id,
      fileName: image.fileName,
      mimeType: image.mimeType,
      fileSize: image.fileSize,
      focusY: image.focusY,
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
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const access = await resolveAccessiblePlan(id, user.id);
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status });
    if (!access.schemaReady) {
      return NextResponse.json(
        { error: 'Banner library is unavailable until database migrations are applied.' },
        { status: 503 }
      );
    }

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const form = await req.formData();
    const incoming = form.get('file');
    const focusY = normalizeFocusY(form.get('focusY'));
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
          focusY,
          content: buffer,
        },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSize: true,
          focusY: true,
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
        focusY: result.created.focusY,
        createdAt: result.created.createdAt.toISOString(),
        isSelected: result.created.id === result.selectedImageId,
        url: `/api/plans/${id}/images/${result.created.id}/file`,
      },
    });
  } catch (error) {
    if (isSchemaError(error)) {
      return NextResponse.json(
        { error: 'Banner library is unavailable until database migrations are applied.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
