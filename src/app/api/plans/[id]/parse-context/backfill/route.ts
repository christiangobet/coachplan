import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ensureUserFromAuth } from '@/lib/user-sync';
import { resolveSourceDocument } from '@/lib/resolve-source-document';
import { maybeRunVisionExtract } from '@/lib/ai-plan-parser';
import { extractPlanGuide } from '@/lib/ai-guide-extractor';
import { populatePlanFromV4 } from '@/lib/parsing/v4-to-plan';
import { resetPlanSchedule } from '@/lib/parsing/reset-plan-schedule';
import type { ProgramJsonV1 } from '@/lib/schemas/program-json-v1';
import {
  buildActivityDraftFromSession,
  derivePlanDayNotes,
} from '@/lib/parsing/v4-persistence-mapping';
import { enrichLegacyDayDraftsFromProgram } from '@/lib/parsing/legacy-program-enrichment';
import { withParserPipelineProfile } from '@/lib/plan-document-profile';
import type { ProgramDocumentProfile } from '@/lib/plan-document-profile';
import { assessProgramWeekCompleteness } from '@/lib/parsing/program-week-completeness';
import { ProgramJsonV1Schema } from '@/lib/schemas/program-json-v1';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await ensureUserFromAuth(authUser, {
    defaultRole: 'ATHLETE',
    defaultCurrentRole: 'ATHLETE',
  });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      ownerId: true,
      athleteId: true,
    },
  });

  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const latestVisionJob = await prisma.parseJob.findFirst({
    where: {
      planId: plan.id,
      parserVersion: 'vision-v1',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      artifacts: {
        orderBy: { createdAt: 'desc' },
        select: {
          artifactType: true,
          validationOk: true,
          json: true,
        },
      },
    },
  });

  const successfulProgramArtifact = latestVisionJob?.artifacts.find((artifact) => {
    if (artifact.artifactType !== 'V4_OUTPUT' || !artifact.validationOk) return false;
    const parsed = ProgramJsonV1Schema.safeParse(artifact.json);
    return parsed.success && assessProgramWeekCompleteness(parsed.data).isComplete;
  }) ?? null;
  const successfulExtractedMdArtifact = latestVisionJob?.artifacts.find((artifact) => {
    if (artifact.artifactType !== 'EXTRACTED_MD' || !artifact.validationOk) return false;
    return typeof (artifact.json as { md?: unknown }).md === 'string';
  }) ?? null;

  let data = successfulProgramArtifact
    ? successfulProgramArtifact.json as ProgramJsonV1
    : null;
  let extractedMd = successfulExtractedMdArtifact
    ? String((successfulExtractedMdArtifact.json as { md: string }).md || '').trim()
    : null;
  let parseWarning: string | null = null;
  let reusedExistingMdProgram = Boolean(data);

  if (!data) {
    const resolvedSource = await resolveSourceDocument(id, true);
    if (!resolvedSource?.doc?.content) {
      return NextResponse.json(
        { error: 'This plan has no source PDF available for markdown backfill.' },
        { status: 404 },
      );
    }
    const pdfBuffer = Buffer.from(resolvedSource.doc.content as unknown as Buffer);
    const visionResult = await maybeRunVisionExtract(pdfBuffer, plan.id);
    data = visionResult.data;
    parseWarning = visionResult.parseWarning;
    extractedMd = visionResult.extractedMd;
    reusedExistingMdProgram = false;
  }

  let planGuide: string | null = null;
  if (extractedMd) {
    try {
      planGuide = await extractPlanGuide(extractedMd);
      if (planGuide) {
        await prisma.trainingPlan.update({
          where: { id: plan.id },
          data: { planGuide },
        });
      }
    } catch {
      // Keep backfill usable even if guide extraction fails.
    }
  }

  if (!data) {
    return NextResponse.json({
      markdownCreated: Boolean(extractedMd),
      mdParseStatus: extractedMd ? (parseWarning?.includes('missing weeks') ? 'partial' : 'available') : 'failed',
      persistedFrom: 'existing-plan-fallback',
      usedFallback: true,
      parseWarning: parseWarning ?? null,
      rebuilt: false,
    });
  }

  const existingWeeks = await prisma.planWeek.findMany({
    where: { planId: plan.id },
    orderBy: { weekIndex: 'asc' },
    include: {
      days: {
        orderBy: { dayOfWeek: 'asc' },
        include: {
          activities: {
            orderBy: { id: 'asc' },
          },
        },
      },
    },
  });
  const existingActivityCount = existingWeeks.reduce(
    (sum, week) => sum + week.days.reduce((daySum, day) => daySum + day.activities.length, 0),
    0,
  );
  const mdSessionCount = data.weeks.reduce(
    (sum, week) => sum + (week.sessions || []).filter((session) => session.activity_type !== 'Rest').length,
    0,
  );
  const shouldFullRebuild =
    existingWeeks.length === 0
    || existingActivityCount === 0
    || existingWeeks.length < Math.max(1, Math.floor(data.weeks.length * 0.6))
    || existingActivityCount < Math.max(1, Math.floor(mdSessionCount * 0.6));

  let persisted: { weeksCreated: number; activitiesCreated: number };
  let persistenceSource: 'markdown-primary' | 'markdown-merged' = 'markdown-merged';

  if (shouldFullRebuild) {
    await resetPlanSchedule(plan.id);
    persisted = await populatePlanFromV4(plan.id, data, {
      parserPipeline: {
        persistenceSource: 'markdown-primary',
        mdParseStatus: 'succeeded',
        extractedMdAttempted: true,
      },
    });
    persistenceSource = 'markdown-primary';
  } else {
    const sourceUnits = data.program?.source_units;
    const existingWeeksByIndex = new Map(existingWeeks.map((week) => [week.weekIndex, week]));
    let activitiesCreated = 0;

    for (const week of [...data.weeks].sort((a, b) => a.week_number - b.week_number)) {
      let targetWeek = existingWeeksByIndex.get(week.week_number) ?? null;
      if (!targetWeek) {
        targetWeek = await prisma.planWeek.create({
          data: {
            planId: plan.id,
            weekIndex: week.week_number,
            coachBrief: week.week_brief ?? null,
          },
          include: { days: { include: { activities: true } } },
        });
        existingWeeksByIndex.set(week.week_number, targetWeek);
      } else if (week.week_brief && week.week_brief !== targetWeek.coachBrief) {
        await prisma.planWeek.update({
          where: { id: targetWeek.id },
          data: { coachBrief: week.week_brief },
        });
      }

      const sessionsByDay = new Map<number, typeof week.sessions>();
      for (const session of week.sessions || []) {
        const dow = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as const)[session.day_of_week || 'Mon'];
        if (!session.day_of_week || !dow) continue;
        const current = sessionsByDay.get(dow) || [];
        current.push(session);
        sessionsByDay.set(dow, current);
      }

      for (const [dayOfWeek, sessions] of sessionsByDay.entries()) {
        const currentDay = targetWeek.days.find((day) => day.dayOfWeek === dayOfWeek) ?? null;
        const markdownDayRawText = sessions.map((session) => session.raw_text).filter(Boolean).join(' | ') || null;
        const markdownDayNotes = derivePlanDayNotes(sessions);

        if (!currentDay) {
          const createdDay = await prisma.planDay.create({
            data: {
              planId: plan.id,
              weekId: targetWeek.id,
              dayOfWeek,
              rawText: markdownDayRawText,
              notes: markdownDayNotes,
            },
          });
          const activityRows = sessions
            .filter((session) => session.activity_type !== 'Rest')
            .map((session) => buildActivityDraftFromSession({
              planId: plan.id,
              dayId: createdDay.id,
              sourceUnits,
              session,
            }));
          if (activityRows.length > 0) {
            await prisma.planActivity.createMany({ data: activityRows });
            activitiesCreated += activityRows.length;
          }
          continue;
        }

        const enriched = enrichLegacyDayDraftsFromProgram({
          planId: plan.id,
          dayId: currentDay.id,
          sourceUnits,
          weekNumber: week.week_number,
          dayOfWeek,
          baseActivities: currentDay.activities.map((activity) => ({
            id: activity.id,
            planId: activity.planId,
            dayId: activity.dayId,
            type: activity.type,
            subtype: activity.subtype,
            title: activity.title,
            rawText: activity.rawText,
            notes: activity.notes,
            sessionInstructions: activity.sessionInstructions,
            distance: activity.distance,
            distanceUnit: activity.distanceUnit,
            duration: activity.duration,
            paceTarget: activity.paceTarget,
            effortTarget: activity.effortTarget,
            structure: activity.structure,
            tags: activity.tags,
            priority: activity.priority,
            bailAllowed: activity.bailAllowed,
            mustDo: activity.mustDo,
            sessionGroupId: activity.sessionGroupId,
            sessionOrder: activity.sessionOrder,
            coachingNote: activity.coachingNote,
            sessionFocus: activity.sessionFocus as ProgramJsonV1['weeks'][number]['sessions'][number]['session_focus'] ?? null,
          })),
          program: data,
        });

        const nextDayRawText = chooseBetterDaySourceText(currentDay.rawText, markdownDayRawText);
        const nextDayNotes = chooseBetterDayNotes(currentDay.notes, enriched.dayNotes);
        if (nextDayRawText !== currentDay.rawText || nextDayNotes !== currentDay.notes) {
          await prisma.planDay.update({
            where: { id: currentDay.id },
            data: {
              rawText: nextDayRawText,
              notes: nextDayNotes,
            },
          });
        }

        for (const mergedActivity of enriched.activities) {
          if (!mergedActivity.id) continue;
          const existingActivity = currentDay.activities.find((activity) => activity.id === mergedActivity.id);
          if (!existingActivity) continue;

          const updates = {
            type: mergedActivity.type as typeof existingActivity.type,
            subtype: mergedActivity.subtype ?? null,
            title: mergedActivity.title,
            rawText: mergedActivity.rawText ?? null,
            notes: mergedActivity.notes ?? null,
            sessionInstructions: mergedActivity.sessionInstructions ?? null,
            distance: mergedActivity.distance ?? null,
            distanceUnit: mergedActivity.distanceUnit ?? null,
            duration: mergedActivity.duration ?? null,
            paceTarget: mergedActivity.paceTarget ?? null,
            effortTarget: mergedActivity.effortTarget ?? null,
            structure: mergedActivity.structure == null
              ? Prisma.DbNull
              : mergedActivity.structure as Prisma.InputJsonValue,
            priority: mergedActivity.priority as typeof existingActivity.priority,
            bailAllowed: mergedActivity.bailAllowed,
            mustDo: mergedActivity.mustDo,
            coachingNote: mergedActivity.coachingNote ?? null,
            sessionFocus: mergedActivity.sessionFocus ?? null,
          };

          if (JSON.stringify({
            type: existingActivity.type,
            subtype: existingActivity.subtype,
            title: existingActivity.title,
            rawText: existingActivity.rawText,
            notes: existingActivity.notes,
            sessionInstructions: existingActivity.sessionInstructions,
            distance: existingActivity.distance,
            distanceUnit: existingActivity.distanceUnit,
            duration: existingActivity.duration,
            paceTarget: existingActivity.paceTarget,
            effortTarget: existingActivity.effortTarget,
            structure: existingActivity.structure,
            priority: existingActivity.priority,
            bailAllowed: existingActivity.bailAllowed,
            mustDo: existingActivity.mustDo,
            coachingNote: existingActivity.coachingNote,
            sessionFocus: existingActivity.sessionFocus,
          }) !== JSON.stringify(updates)) {
            await prisma.planActivity.update({
              where: { id: existingActivity.id },
              data: updates,
            });
          }
        }
      }
    }

    const currentPlan = await prisma.trainingPlan.findUnique({
      where: { id: plan.id },
      select: { parseProfile: true },
    });
    await prisma.trainingPlan.update({
      where: { id: plan.id },
      data: {
        weekCount: data.weeks.length,
        status: 'DRAFT',
        parseProfile: withParserPipelineProfile(
          (currentPlan?.parseProfile && typeof currentPlan.parseProfile === 'object'
            ? currentPlan.parseProfile
            : {}) as ProgramDocumentProfile,
          {
            persistence_source: 'markdown-merged',
            md_parse_status: 'succeeded',
            extracted_md_attempted: true,
          },
        ),
      },
    });
    persisted = {
      weeksCreated: data.weeks.length,
      activitiesCreated,
    };
  }

  return NextResponse.json({
    markdownCreated: Boolean(extractedMd),
    mdParseStatus: 'succeeded',
    persistedFrom: persistenceSource,
    usedFallback: false,
    parseWarning: parseWarning ?? null,
    rebuilt: true,
    reusedExistingMdProgram,
    weeksCreated: persisted.weeksCreated,
    activitiesCreated: persisted.activitiesCreated,
    planGuideCreated: Boolean(planGuide),
  });
}

function chooseBetterDaySourceText(currentText: string | null, markdownText: string | null) {
  const current = normalizeInlineText(currentText);
  const markdown = normalizeInlineText(markdownText);
  if (!markdown) return currentText;
  if (!current) return markdownText;
  if (markdown.includes(current) && markdown.length > current.length) return markdownText;
  return currentText;
}

function chooseBetterDayNotes(currentNotes: string | null, markdownNotes: string | null) {
  const current = normalizeInlineText(currentNotes);
  const markdown = normalizeInlineText(markdownNotes);
  if (!markdown) return currentNotes;
  if (!current) return markdownNotes;
  if (current === markdown || current.includes(markdown)) return currentNotes;
  if (markdown.includes(current)) return markdownNotes;
  return `${currentNotes}\n\n${markdownNotes}`;
}

function normalizeInlineText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
