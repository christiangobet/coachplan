import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRoleApi } from '@/lib/role-guards';

export async function GET() {
  const access = await requireRoleApi('COACH');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const templates = await prisma.trainingPlan.findMany({
    where: { ownerId: access.context.userId, isTemplate: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const access = await requireRoleApi('COACH');
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await req.json();
  const name = (body?.name || '').trim();
  const weekCount = body?.weekCount ? Number(body.weekCount) : null;
  const raceName = body?.raceName && typeof body.raceName === 'string'
    ? body.raceName.trim()
    : '';
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const template = await prisma.trainingPlan.create({
    data: {
      name,
      raceName: raceName || null,
      description: body?.description || null,
      isTemplate: true,
      status: 'DRAFT',
      weekCount: weekCount || null,
      raceType: body?.raceType || null,
      difficulty: body?.difficulty || null,
      isPublic: body?.isPublic ?? false,
      ownerId: access.context.userId,
    },
  });

  return NextResponse.json({ template });
}
