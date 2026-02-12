import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    include: {
      weeks: { include: { days: { include: { activities: true } } } },
      days: { include: { activities: true } },
      activities: true
    }
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ plan });
}
