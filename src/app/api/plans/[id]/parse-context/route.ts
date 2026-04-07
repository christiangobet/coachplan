import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { buildParseContextSummary } from "@/lib/plan-parse-context";
import { resolveSourceDocument } from "@/lib/resolve-source-document";
import { isAsyncUploadProcessing, scheduleAsyncUploadProcessing } from "@/lib/parsing/async-upload-processor";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await ensureUserFromAuth(authUser, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE",
  });

  const { id } = await params;
  const plan = await prisma.trainingPlan.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      athleteId: true,
      planGuide: true,
      parseProfile: true,
    },
  });

  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (plan.ownerId !== user.id && plan.athleteId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [jobs, sourceDocument] = await Promise.all([
    prisma.parseJob.findMany({
      where: {
        planId: id,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        parserVersion: true,
        status: true,
        createdAt: true,
        artifacts: {
          orderBy: { createdAt: "desc" },
          select: {
            artifactType: true,
            validationOk: true,
            createdAt: true,
            json: true,
          },
        },
      },
    }),
    resolveSourceDocument(id),
  ]);

  const latestUploadJob = jobs.find((job) => job.parserVersion === "upload-async") ?? null;
  if (latestUploadJob?.status === "RUNNING" && !isAsyncUploadProcessing(latestUploadJob.id)) {
    scheduleAsyncUploadProcessing(latestUploadJob.id);
  }

  const summary = buildParseContextSummary({
    jobs,
    parseProfile: plan.parseProfile,
    hasSourceDocument: Boolean(sourceDocument),
  });

  return NextResponse.json({
    planGuide: plan.planGuide ?? null,
    extractedMd: summary.extractedMd,
    parseJobId: summary.parseJobId,
    parseJobCreatedAt: summary.parseJobCreatedAt,
    extractedMdCreatedAt: summary.extractedMdCreatedAt,
    hasExtractedMd: summary.hasExtractedMd,
    mdParseStatus: summary.mdParseStatus,
    persistenceSource: summary.persistenceSource,
    canBackfillExtractedMd: summary.canBackfillExtractedMd,
    canApplyMdProgram: summary.canApplyMdProgram,
    missingWeekNumbers: summary.missingWeekNumbers,
    uploadStatus: summary.uploadStatus,
    uploadStage: summary.uploadStage,
    uploadFailureReason: summary.uploadFailureReason,
    uploadWeekCount: summary.uploadWeekCount,
    uploadSessionCount: summary.uploadSessionCount,
  });
}
