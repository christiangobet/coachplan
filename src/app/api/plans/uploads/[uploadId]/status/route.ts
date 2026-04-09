import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import { ensureUserFromAuth } from "@/lib/user-sync";
import { buildUploadStatusSummary } from "@/lib/upload-progress";
import { isAsyncUploadProcessing, scheduleAsyncUploadProcessing } from "@/lib/parsing/async-upload-processor";

export async function GET(_req: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const authUser = await currentUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await ensureUserFromAuth(authUser, {
    defaultRole: "ATHLETE",
    defaultCurrentRole: "ATHLETE",
  });

  const { uploadId } = await params;
  const job = await prisma.parseJob.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      planId: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      artifacts: {
        where: { artifactType: "UPLOAD_PIPELINE_STATUS" },
        orderBy: { createdAt: "desc" },
        select: {
          artifactType: true,
          validationOk: true,
          createdAt: true,
          json: true,
        },
      },
      plan: {
        select: {
          ownerId: true,
          athleteId: true,
        },
      },
    },
  });

  if (!job || !job.planId || !job.plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.plan.ownerId !== user.id && job.plan.athleteId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const extractedMdArtifact = await prisma.parseArtifact.findFirst({
    where: {
      artifactType: "EXTRACTED_MD",
      validationOk: true,
      parseJob: {
        planId: job.planId,
        parserVersion: "vision-v1",
      },
    },
    orderBy: { createdAt: "desc" },
    select: { json: true },
  });
  const extractedMd = extractedMdArtifact?.json && typeof extractedMdArtifact.json === "object"
    ? (extractedMdArtifact.json as { md?: unknown }).md
    : null;

  if (job.status === "RUNNING" && !isAsyncUploadProcessing(uploadId)) {
    scheduleAsyncUploadProcessing(uploadId);
  }

  const summary = buildUploadStatusSummary({
    job,
    extractedMd: typeof extractedMd === "string" ? extractedMd : null,
  });

  return NextResponse.json(summary);
}
