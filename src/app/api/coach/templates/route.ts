import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const templates = await prisma.trainingPlan.findMany({
    where: { ownerId: user.id, isTemplate: true },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const name = (body?.name || '').trim();
  const weekCount = body?.weekCount ? Number(body.weekCount) : null;
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const template = await prisma.trainingPlan.create({
    data: {
      name,
      isTemplate: true,
      status: 'DRAFT',
      weekCount: weekCount || null,
      ownerId: user.id
    }
  });

  return NextResponse.json({ template });
}
