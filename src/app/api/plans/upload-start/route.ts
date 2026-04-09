import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";
import { createParseJob } from "@/lib/parsing/parse-artifacts";
import { saveUploadLifecycleStatus, scheduleAsyncUploadProcessing } from "@/lib/parsing/async-upload-processor";
import { planNameFromFilename } from "@/lib/parsing/upload-normalizers";

const PLAN_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const MAX_PLAN_UPLOADS_PER_WINDOW = 10;
const PDF_MAGIC_PREFIX = "%PDF-";

function looksLikePdfBuffer(buffer: Buffer) {
  if (buffer.byteLength < PDF_MAGIC_PREFIX.length) return false;
  return buffer.subarray(0, PDF_MAGIC_PREFIX.length).toString("ascii") === PDF_MAGIC_PREFIX;
}

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const maybeFile = form.get("file");
    const raceName = form.get("raceName") ? String(form.get("raceName")).trim() : null;
    const raceDateInput = form.get("raceDate");
    let name = String(form.get("name") || "").trim();

    if (!(maybeFile instanceof File) || maybeFile.size <= 0) {
      return NextResponse.json({ error: "PDF file required" }, { status: 400 });
    }

    if (maybeFile.name) {
      name = planNameFromFilename(maybeFile.name);
    }
    if (!name) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }

    const recentUploadCount = await prisma.planSourceDocument.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - PLAN_UPLOAD_WINDOW_MS),
        },
        plan: {
          is: {
            ownerId: user.id,
          },
        },
      },
    });

    if (recentUploadCount >= MAX_PLAN_UPLOADS_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many uploads. Please wait before uploading another PDF." },
        { status: 429 },
      );
    }

    const buffer = Buffer.from(await maybeFile.arrayBuffer());
    if (!looksLikePdfBuffer(buffer)) {
      return NextResponse.json({ error: "Uploaded file must be a valid PDF" }, { status: 400 });
    }

    const raceDate = typeof raceDateInput === "string" && raceDateInput.trim()
      ? new Date(raceDateInput)
      : null;
    if (raceDate && Number.isNaN(raceDate.getTime())) {
      return NextResponse.json({ error: "raceDate must be a valid ISO date string" }, { status: 400 });
    }

    const plan = await prisma.trainingPlan.create({
      data: {
        name,
        raceName: raceName || null,
        raceDate,
        isTemplate: false,
        status: "DRAFT",
        ownerId: user.id,
        athleteId: user.id,
      },
      select: { id: true, name: true },
    });

    const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
    await prisma.planSourceDocument.create({
      data: {
        planId: plan.id,
        fileName: maybeFile.name || `${name}.pdf`,
        mimeType: "application/pdf",
        fileSize: buffer.byteLength,
        checksumSha256,
        content: buffer,
      },
    });

    const uploadJob = await createParseJob({
      planId: plan.id,
      parserVersion: "upload-async",
    });

    await saveUploadLifecycleStatus(uploadJob.id, {
      stage: "queued",
      planId: plan.id,
      hasExtractedMd: false,
      extractedMdAvailable: false,
    });

    scheduleAsyncUploadProcessing(uploadJob.id);

    console.info("[upload-start] queued async PDF upload", {
      planId: plan.id,
      uploadId: uploadJob.id,
      fileName: maybeFile.name || null,
      fileSize: maybeFile.size || 0,
    });

    return NextResponse.json({
      uploadId: uploadJob.id,
      planId: plan.id,
      status: "processing",
      stage: "queued",
    });
  } catch (error) {
    console.error("[upload-start] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to start async upload", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
