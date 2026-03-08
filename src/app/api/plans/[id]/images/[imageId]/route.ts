import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

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
    select: { id: true, planId: true },
  });
  if (!image || image.planId !== planId) return null;
  return image;
}

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, imageId } = await params;
  const access = await resolveAccessiblePlan(id, user.id);
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const image = await resolvePlanImage(id, imageId);
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  await prisma.trainingPlan.update({
    where: { id },
    data: { bannerImageId: image.id },
  });

  return NextResponse.json({
    selectedImageId: image.id,
    banner: {
      imageId: image.id,
      url: `/api/plans/${id}/images/${image.id}/file`,
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
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
}
