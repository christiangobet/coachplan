import { prisma } from "@/lib/prisma";
import { extractPlanMd } from "@/lib/pdf/pdf-to-md";
import { extractPlanGuide } from "@/lib/ai-guide-extractor";
import { parseExtractedMarkdownToProgram } from "@/lib/ai-plan-parser";
import { populatePlanFromV4 } from "@/lib/parsing/v4-to-plan";
import { createParseJob, saveParseArtifact, updateParseJobStatus } from "@/lib/parsing/parse-artifacts";
import {
  createUploadLifecycleArtifact,
  selectLatestUploadLifecycleArtifact,
  type UploadLifecycleArtifact,
  type UploadLifecycleStage,
} from "@/lib/upload-progress";
import { assessProgramWeekCompleteness } from "@/lib/parsing/program-week-completeness";
import { ProgramJsonV1Schema, type ProgramJsonV1 } from "@/lib/schemas/program-json-v1";

declare global {
  // eslint-disable-next-line no-var
  var __coachplanAsyncUploadWorkers: Map<string, Promise<void>> | undefined;
}

function getWorkerRegistry() {
  if (!globalThis.__coachplanAsyncUploadWorkers) {
    globalThis.__coachplanAsyncUploadWorkers = new Map<string, Promise<void>>();
  }
  return globalThis.__coachplanAsyncUploadWorkers;
}

export function isAsyncUploadProcessing(uploadId: string) {
  return getWorkerRegistry().has(uploadId);
}

export function scheduleAsyncUploadProcessing(uploadId: string) {
  const registry = getWorkerRegistry();
  if (registry.has(uploadId)) return false;

  const task = processAsyncUpload(uploadId)
    .catch((error) => {
      console.error("[AsyncUpload] worker crashed", {
        uploadId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      registry.delete(uploadId);
    });

  registry.set(uploadId, task);
  return true;
}

export async function saveUploadLifecycleStatus(
  uploadId: string,
  artifact: Partial<UploadLifecycleArtifact> & Pick<UploadLifecycleArtifact, "stage">,
) {
  await saveParseArtifact({
    parseJobId: uploadId,
    artifactType: "UPLOAD_PIPELINE_STATUS",
    schemaVersion: "v2",
    json: createUploadLifecycleArtifact(artifact),
    validationOk: artifact.stage !== "failed",
  });
}

async function processAsyncUpload(uploadId: string) {
  const uploadJob = await prisma.parseJob.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      planId: true,
      status: true,
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
          id: true,
          name: true,
          parseProfile: true,
          sourceDocument: {
            select: {
              id: true,
              content: true,
              fileName: true,
            },
          },
        },
      },
    },
  });

  if (!uploadJob?.planId || !uploadJob.plan?.sourceDocument?.content) {
    await failUpload(uploadId, "source_document_missing");
    return;
  }

  if (uploadJob.status === "SUCCESS" || uploadJob.status === "FAILED") {
    return;
  }

  const latestLifecycle = selectLatestUploadLifecycleArtifact(uploadJob.artifacts);
  if (latestLifecycle?.stage === "completed" || latestLifecycle?.stage === "failed") {
    return;
  }

  const planId = uploadJob.planId;
  let extractedMd = await getLatestExtractedMd(planId);

  if (!extractedMd) {
    await saveUploadLifecycleStatus(uploadId, {
      stage: "extracting_markdown",
      planId,
      hasExtractedMd: false,
      extractedMdAvailable: false,
    });

    try {
      const planMd = await extractPlanMd(Buffer.from(uploadJob.plan.sourceDocument.content));
      const visionJob = await createParseJob({ planId, parserVersion: "vision-v1" });

      await saveParseArtifact({
        parseJobId: visionJob.id,
        artifactType: "EXTRACTED_MD",
        schemaVersion: "v1",
        json: { md: planMd },
        validationOk: true,
      });
      await updateParseJobStatus(visionJob.id, "SUCCESS").catch(() => {});

      // Non-blocking: enrich planGuide in background after markdown is saved.
      // extractPlanGuide is not used by parseExtractedMarkdownToProgram, so
      // the pipeline must not wait for it — let it resolve whenever the AI responds.
      void extractPlanGuide(planMd)
        .then(async (guide) => {
          if (!guide.trim()) return;
          await prisma.trainingPlan.update({ where: { id: planId }, data: { planGuide: guide } });
        })
        .catch(() => {});

      await saveUploadLifecycleStatus(uploadId, {
        stage: "markdown_available",
        planId,
        hasExtractedMd: true,
        extractedMdAvailable: true,
      });
      extractedMd = planMd.trim();
    } catch (error) {
      await failUpload(uploadId, error instanceof Error ? error.message : String(error), {
        planId,
        hasExtractedMd: false,
      });
      return;
    }
  }

  const existingProgram = await getLatestSuccessfulProgram(planId);
  let program = existingProgram;

  if (!program) {
    await saveUploadLifecycleStatus(uploadId, {
      stage: "parsing_markdown",
      planId,
      hasExtractedMd: true,
      extractedMdAvailable: true,
    });

    const visionJob = await createParseJob({ planId, parserVersion: "vision-v1" });
    const parsed = await parseExtractedMarkdownToProgram(extractedMd, visionJob.id);
    if (!parsed.data) {
      await failUpload(uploadId, parsed.parseWarning || "markdown_program_missing", {
        planId,
        hasExtractedMd: true,
      });
      return;
    }

    program = parsed.data;
  }

  const weekCount = program.weeks.length;
  const sessionCount = program.weeks.reduce((sum, w) => sum + w.sessions.length, 0);

  await saveUploadLifecycleStatus(uploadId, {
    stage: "persisting_plan",
    planId,
    hasExtractedMd: true,
    extractedMdAvailable: true,
    weekCount,
    sessionCount,
  });

  await clearPlanDraftRows(planId);
  await populatePlanFromV4(planId, program, {
    parserPipeline: {
      persistenceSource: "markdown-primary",
      mdParseStatus: "succeeded",
      extractedMdAttempted: true,
    },
  });

  await saveUploadLifecycleStatus(uploadId, {
    stage: "completed",
    status: "completed",
    planId,
    hasExtractedMd: true,
    extractedMdAvailable: true,
    completedPlanId: planId,
    weekCount,
    sessionCount,
  });
  await updateParseJobStatus(uploadId, "SUCCESS").catch(() => {});
}

async function getLatestExtractedMd(planId: string) {
  const artifact = await prisma.parseArtifact.findFirst({
    where: {
      artifactType: "EXTRACTED_MD",
      validationOk: true,
      parseJob: {
        planId,
        parserVersion: "vision-v1",
      },
    },
    orderBy: { createdAt: "desc" },
    select: { json: true },
  });

  const md = artifact?.json && typeof artifact.json === "object"
    ? (artifact.json as { md?: unknown }).md
    : null;

  return typeof md === "string" && md.trim() ? md.trim() : null;
}

async function getLatestSuccessfulProgram(planId: string) {
  const artifact = await prisma.parseArtifact.findFirst({
    where: {
      artifactType: "V4_OUTPUT",
      validationOk: true,
      parseJob: {
        planId,
        parserVersion: "vision-v1",
      },
    },
    orderBy: { createdAt: "desc" },
    select: { json: true },
  });

  const parsed = ProgramJsonV1Schema.safeParse(artifact?.json);
  if (!parsed.success) return null;

  const completeness = assessProgramWeekCompleteness(parsed.data);
  return completeness.isComplete ? (parsed.data as ProgramJsonV1) : null;
}

async function clearPlanDraftRows(planId: string) {
  await prisma.planActivity.deleteMany({ where: { planId } });
  await prisma.planDay.deleteMany({ where: { planId } });
  await prisma.planWeek.deleteMany({ where: { planId } });
}

async function failUpload(
  uploadId: string,
  failureReason: string,
  options?: {
    planId?: string;
    hasExtractedMd?: boolean;
  },
) {
  const planId = options?.planId ?? null;
  const hasExtractedMd = options?.hasExtractedMd ?? false;
  const stage: UploadLifecycleStage = "failed";

  await saveUploadLifecycleStatus(uploadId, {
    stage,
    status: "failed",
    planId,
    failureReason,
    hasExtractedMd,
    extractedMdAvailable: hasExtractedMd,
  }).catch(() => {});
  await updateParseJobStatus(uploadId, "FAILED", failureReason).catch(() => {});
}
