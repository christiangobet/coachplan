import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import { ensureUserFromAuth } from "@/lib/user-sync";

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
      planId: true,
      plan: {
        select: {
          ownerId: true,
          athleteId: true,
        },
      },
    },
  });

  if (!job?.planId || !job.plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.plan.ownerId !== user.id && job.plan.athleteId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const artifact = await prisma.parseArtifact.findFirst({
    where: {
      artifactType: "EXTRACTED_MD",
      validationOk: true,
      parseJob: {
        planId: job.planId,
        parserVersion: "vision-v1",
      },
    },
    orderBy: { createdAt: "desc" },
    select: { json: true, createdAt: true },
  });

  const md = artifact?.json && typeof artifact.json === "object"
    ? (artifact.json as { md?: unknown }).md
    : null;

  if (typeof md !== "string" || !md.trim()) {
    return NextResponse.json({ error: "Extracted markdown not available yet" }, { status: 404 });
  }

  return NextResponse.json({
    extractedMd: md.trim(),
    extractedMdCreatedAt: artifact?.createdAt.toISOString(),
  });
}
