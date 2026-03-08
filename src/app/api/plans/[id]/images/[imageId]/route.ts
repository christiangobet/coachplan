import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

function isSchemaError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2021' || error.code === 'P2022';
}

function normalizeFocusY(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

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

async function resolvePlanImage(planId: string, imageId: string) {
  const image = await prisma.planImage.findUnique({
    where: { id: imageId },
    select: { id: true, planId: true, focusY: true },
  });
  if (!image || image.planId !== planId) return null;
  return image;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, imageId } = await params;
    const access = await resolveAccessiblePlan(id, user.id);
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const image = await resolvePlanImage(id, imageId);
    if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const focusY = normalizeFocusY(body?.focusY);
    const selectImage = body?.select === false ? false : true;

    let nextFocusY = image.focusY;
    await prisma.$transaction(async (tx) => {
      if (focusY !== null) {
        const updated = await tx.planImage.update({
          where: { id: image.id },
          data: { focusY },
          select: { focusY: true },
        });
        nextFocusY = updated.focusY;
      }
      if (selectImage) {
        await tx.trainingPlan.update({
          where: { id },
          data: { bannerImageId: image.id },
        });
      }
    });

    return NextResponse.json({
      selectedImageId: selectImage ? image.id : access.plan.bannerImageId,
      image: {
        id: image.id,
        focusY: nextFocusY,
        url: `/api/plans/${id}/images/${image.id}/file`,
      },
      banner: {
        imageId: image.id,
        url: `/api/plans/${id}/images/${image.id}/file`,
        focusY: nextFocusY,
      },
    });
  } catch (error) {
    if (isSchemaError(error)) {
      return NextResponse.json(
        { error: 'Banner library is unavailable until database migrations are applied.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Failed to update banner image' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, imageId } = await params;
    const access = await resolveAccessiblePlan(id, user.id);
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const image = await resolvePlanImage(id, imageId);
    if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      if (access.plan.bannerImageId === image.id) {
        await tx.trainingPlan.update({
          where: { id },
          data: { bannerImageId: null },
        });
      }
      await tx.planImage.delete({ where: { id: image.id } });
    });

    return NextResponse.json({
      deleted: true,
      id: image.id,
      selectedImageId: access.plan.bannerImageId === image.id ? null : access.plan.bannerImageId,
    });
  } catch (error) {
    if (isSchemaError(error)) {
      return NextResponse.json(
        { error: 'Banner library is unavailable until database migrations are applied.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Failed to delete image' }, { status: 500 });
  }
}
