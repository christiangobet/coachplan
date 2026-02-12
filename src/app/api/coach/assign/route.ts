import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const templateId = body?.templateId as string;
  const athleteId = body?.athleteId as string;
  if (!templateId || !athleteId) {
    return NextResponse.json({ error: 'templateId and athleteId required' }, { status: 400 });
  }

  const template = await prisma.trainingPlan.findUnique({
    where: { id: templateId },
    include: {
      weeks: { include: { days: { include: { activities: true } } } }
    }
  });
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const newPlan = await prisma.trainingPlan.create({
    data: {
      name: template.name,
      isTemplate: false,
      status: 'ACTIVE',
      weekCount: template.weekCount,
      ownerId: user.id,
      athleteId
    }
  });

  const weekMap: Record<string, string> = {};
  const dayMap: Record<string, string> = {};
  for (const week of template.weeks) {
    const created = await prisma.planWeek.create({
      data: {
        planId: newPlan.id,
        weekIndex: week.weekIndex,
        startDate: week.startDate,
        endDate: week.endDate
      }
    });
    weekMap[week.id] = created.id;

    for (const day of week.days) {
      const createdDay = await prisma.planDay.create({
        data: {
          planId: newPlan.id,
          weekId: created.id,
          dayOfWeek: day.dayOfWeek,
          rawText: day.rawText || null,
          notes: day.notes || null
        }
      });
      dayMap[day.id] = createdDay.id;
    }
  }

  const activities = template.weeks.flatMap((week) =>
    week.days.flatMap((day) =>
      day.activities.map((a) => ({
        planId: newPlan.id,
        dayId: dayMap[day.id],
        type: a.type,
        subtype: a.subtype || null,
        title: a.title,
        rawText: a.rawText || null,
        distance: a.distance || null,
        distanceUnit: a.distanceUnit || null,
        duration: a.duration || null,
        paceTarget: a.paceTarget || null,
        effortTarget: a.effortTarget || null,
        structure: a.structure || undefined,
        tags: a.tags || undefined,
        priority: a.priority || null,
        bailAllowed: a.bailAllowed,
        mustDo: a.mustDo,
        notes: a.notes || null
      }))
    )
  );

  if (activities.length) {
    await prisma.planActivity.createMany({ data: activities });
  }

  return NextResponse.json({ assigned: true, planId: newPlan.id });
}
