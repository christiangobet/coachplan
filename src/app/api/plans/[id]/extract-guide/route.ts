import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { extractPlanGuide } from '@/lib/ai-guide-extractor';
import { extractPlanSummary } from '@/lib/ai-summary-extractor';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: planId } = await params;

    const plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      include: {
        weeks: {
          orderBy: { weekIndex: 'asc' },
          include: {
            days: { orderBy: { dayOfWeek: 'asc' } }
          }
        }
      }
    });

    if (!plan) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (plan.ownerId !== userId && plan.athleteId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Build a text corpus from stored rawText values (no PDF re-parsing needed)
    const lines: string[] = [`Plan: ${plan.name}`];
    let rawTextCount = 0;
    for (const week of plan.weeks) {
      lines.push(`\nWeek ${week.weekIndex}:`);
      for (const day of week.days) {
        if (day.rawText?.trim()) {
          lines.push(day.rawText.trim());
          rawTextCount++;
        }
      }
    }
    const fullText = lines.join('\n');

    if (rawTextCount === 0) {
      return NextResponse.json(
        { error: `No raw text found in plan days (${plan.weeks.length} weeks). The plan may need to be re-uploaded to store session text.` },
        { status: 422 }
      );
    }

    if (fullText.trim().length < 50) {
      return NextResponse.json(
        { error: `Plan text too short (${fullText.trim().length} chars) to extract a guide from.` },
        { status: 422 }
      );
    }

    let planGuide = '';
    try {
      planGuide = await extractPlanGuide(fullText, { throwOnError: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI guide extraction failed';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    if (!planGuide) {
      return NextResponse.json(
        { error: 'AI returned empty guide — try again or paste the guide manually' },
        { status: 502 }
      );
    }

    // Also extract structured summary (best-effort — does not fail the request)
    const planSummary = await extractPlanSummary(fullText, { throwOnError: false });

    await prisma.trainingPlan.update({
      where: { id: planId },
      data: {
        planGuide,
        ...(planSummary && { planSummary: planSummary as Prisma.InputJsonValue }),
      }
    });

    return NextResponse.json({ planGuide, planSummary: planSummary ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[extract-guide] Unexpected error:', message);
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
  }
}
