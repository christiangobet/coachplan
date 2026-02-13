import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const template = await prisma.trainingPlan.findUnique({
    where: { id, isTemplate: true },
    include: {
      owner: { select: { name: true } },
      weeks: {
        orderBy: { weekIndex: 'asc' },
        include: {
          days: {
            orderBy: { dayOfWeek: 'asc' },
            include: {
              activities: {
                select: {
                  id: true,
                  type: true,
                  subtype: true,
                  title: true,
                  distance: true,
                  distanceUnit: true,
                  duration: true,
                  paceTarget: true,
                  effortTarget: true,
                  mustDo: true,
                  priority: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template });
}
