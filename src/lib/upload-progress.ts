export type UploadLifecycleStage =
  | "queued"
  | "extracting_markdown"
  | "markdown_available"
  | "parsing_markdown"
  | "persisting_plan"
  | "completed"
  | "failed";

export type UploadLifecycleStatus = "processing" | "completed" | "failed";

export type UploadLifecycleArtifact = {
  status: UploadLifecycleStatus;
  stage: UploadLifecycleStage;
  failureReason: string | null;
  hasExtractedMd: boolean;
  extractedMdAvailable: boolean;
  completedPlanId: string | null;
  planId?: string | null;
  weekCount?: number;
  sessionCount?: number;
};

export type UploadLifecycleArtifactLike = {
  artifactType: string;
  validationOk: boolean;
  createdAt: string | Date;
  json: unknown;
};

export type UploadLifecycleJobLike = {
  id: string;
  planId?: string | null;
  status?: string | null;
  createdAt: string | Date;
  errorMessage?: string | null;
  artifacts: UploadLifecycleArtifactLike[];
};

export type UploadStatusSummary = {
  uploadId: string;
  planId: string | null;
  status: UploadLifecycleStatus;
  stage: UploadLifecycleStage;
  failureReason: string | null;
  hasExtractedMd: boolean;
  extractedMdAvailable: boolean;
  extractedMdPreview: string | null;
  completedPlanId: string | null;
  weekCount: number | null;
  sessionCount: number | null;
};

export function createUploadLifecycleArtifact(
  artifact: Partial<UploadLifecycleArtifact> & Pick<UploadLifecycleArtifact, "stage">,
): UploadLifecycleArtifact {
  const stage = artifact.stage;
  const status = artifact.status ?? (stage === "completed" ? "completed" : stage === "failed" ? "failed" : "processing");

  return {
    status,
    stage,
    failureReason: artifact.failureReason ?? null,
    hasExtractedMd: artifact.hasExtractedMd ?? false,
    extractedMdAvailable: artifact.extractedMdAvailable ?? artifact.hasExtractedMd ?? false,
    completedPlanId: artifact.completedPlanId ?? null,
    planId: artifact.planId ?? null,
    weekCount: artifact.weekCount,
    sessionCount: artifact.sessionCount,
  };
}

export function buildUploadStatusSummary(args: {
  job: UploadLifecycleJobLike;
  extractedMd: string | null;
}): UploadStatusSummary {
  const latestArtifact = selectLatestUploadLifecycleArtifact(args.job.artifacts);
  const hasExtractedMd = Boolean(args.extractedMd?.trim()) || Boolean(latestArtifact?.hasExtractedMd);
  const extractedMdAvailable = hasExtractedMd || Boolean(latestArtifact?.extractedMdAvailable);
  const fallbackStatus = args.job.status === "SUCCESS" ? "completed" : args.job.status === "FAILED" ? "failed" : "processing";
  const fallbackStage = fallbackStatus === "completed" ? "completed" : fallbackStatus === "failed" ? "failed" : "queued";

  return {
    uploadId: args.job.id,
    planId: args.job.planId ?? null,
    status: latestArtifact?.status ?? fallbackStatus,
    stage: latestArtifact?.stage ?? fallbackStage,
    failureReason: latestArtifact?.failureReason ?? args.job.errorMessage ?? null,
    hasExtractedMd,
    extractedMdAvailable,
    extractedMdPreview: args.extractedMd?.trim() ? args.extractedMd.trim() : null,
    completedPlanId: latestArtifact?.completedPlanId ?? (fallbackStatus === "completed" ? (args.job.planId ?? null) : null),
    weekCount: latestArtifact?.weekCount ?? null,
    sessionCount: latestArtifact?.sessionCount ?? null,
  };
}

export function selectLatestUploadLifecycleArtifact(
  artifacts: UploadLifecycleArtifactLike[],
): UploadLifecycleArtifact | null {
  for (const artifact of artifacts) {
    if (artifact.artifactType !== "UPLOAD_PIPELINE_STATUS") continue;
    if (!artifact.json || typeof artifact.json !== "object") continue;
    const candidate = artifact.json as Partial<UploadLifecycleArtifact>;
    if (typeof candidate.stage !== "string") continue;
    return createUploadLifecycleArtifact({
      status: candidate.status as UploadLifecycleStatus | undefined,
      stage: candidate.stage as UploadLifecycleStage,
      failureReason: typeof candidate.failureReason === "string" ? candidate.failureReason : null,
      hasExtractedMd: Boolean(candidate.hasExtractedMd),
      extractedMdAvailable: Boolean(candidate.extractedMdAvailable),
      completedPlanId: typeof candidate.completedPlanId === "string" ? candidate.completedPlanId : null,
      planId: typeof candidate.planId === "string" ? candidate.planId : null,
      weekCount: typeof candidate.weekCount === "number" ? candidate.weekCount : undefined,
      sessionCount: typeof candidate.sessionCount === "number" ? candidate.sessionCount : undefined,
    });
  }

  return null;
}
