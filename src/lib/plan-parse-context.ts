import { assessProgramWeekCompleteness } from "./parsing/program-week-completeness.ts";
import { ProgramJsonV1Schema } from "./schemas/program-json-v1.ts";
import {
  selectLatestUploadLifecycleArtifact,
  type UploadLifecycleStage,
  type UploadLifecycleStatus,
} from "./upload-progress.ts";

export type ExtractedMdArtifactLike = {
  artifactType: string;
  validationOk: boolean;
  createdAt: string | Date;
  json: unknown;
};

export type ExtractedMdJobLike = {
  id: string;
  parserVersion?: string | null;
  status?: string | null;
  createdAt: string | Date;
  artifacts: ExtractedMdArtifactLike[];
};

export type LatestExtractedMd = {
  parseJobId: string | null;
  parseJobCreatedAt: string | null;
  extractedMd: string | null;
  extractedMdCreatedAt: string | null;
};

export type ParseContextSummary = LatestExtractedMd & {
  hasExtractedMd: boolean;
  mdParseStatus: 'missing' | 'available' | 'partial' | 'succeeded' | 'failed';
  persistenceSource: string | null;
  canBackfillExtractedMd: boolean;
  canApplyMdProgram: boolean;
  missingWeekNumbers: number[];
  uploadStatus: UploadLifecycleStatus | null;
  uploadStage: UploadLifecycleStage | null;
  uploadFailureReason: string | null;
  uploadWeekCount: number | null;
  uploadSessionCount: number | null;
};

export function selectLatestExtractedMd(jobs: ExtractedMdJobLike[]): LatestExtractedMd {
  for (const job of jobs) {
    const artifact = job.artifacts.find((entry) => {
      if (entry.artifactType !== "EXTRACTED_MD" || !entry.validationOk) return false;
      const md = (entry.json as { md?: unknown } | null)?.md;
      return typeof md === "string" && md.trim().length > 0;
    });

    if (!artifact) continue;
    return {
      parseJobId: job.id,
      parseJobCreatedAt: toIsoString(job.createdAt),
      extractedMd: ((artifact.json as { md: string }).md || "").trim(),
      extractedMdCreatedAt: toIsoString(artifact.createdAt),
    };
  }

  return {
    parseJobId: null,
    parseJobCreatedAt: null,
    extractedMd: null,
    extractedMdCreatedAt: null,
  };
}

export function buildCombinedGuideMarkdown(planGuide: string | null | undefined, extractedMd: string | null | undefined) {
  const cleanedGuide = normalizeMarkdownBlock(planGuide);
  const cleanedExtractedMd = normalizeMarkdownBlock(extractedMd);

  return [
    "# Plan Context Guide",
    "",
    cleanedGuide || "_No guide yet._",
    "",
    "---",
    "",
    "# Extracted Training Plan Markdown",
    "",
    cleanedExtractedMd || "_No extracted markdown available._",
  ].join("\n");
}

export function buildParseContextSummary(args: {
  jobs: ExtractedMdJobLike[];
  parseProfile: unknown;
  hasSourceDocument: boolean;
}): ParseContextSummary {
  const extracted = selectLatestExtractedMd(args.jobs);
  const hasExtractedMd = Boolean(extracted.extractedMd);
  const latestVisionJob = args.jobs.find((job) => job.parserVersion === 'vision-v1') ?? null;
  const latestUploadJob = args.jobs.find((job) => job.parserVersion === 'upload-async') ?? null;
  const latestUploadLifecycle = latestUploadJob
    ? selectLatestUploadLifecycleArtifact(latestUploadJob.artifacts)
    : null;
  const latestVisionProgramArtifact = args.jobs
    .filter((job) => job.parserVersion === 'vision-v1')
    .flatMap((job) => job.artifacts
      .filter((artifact) => artifact.artifactType === 'V4_OUTPUT')
      .map((artifact) => ({ job, artifact })))
    .sort((a, b) => String(b.artifact.createdAt).localeCompare(String(a.artifact.createdAt)))[0] ?? null;
  const latestVisionProgram = latestVisionProgramArtifact
    ? ProgramJsonV1Schema.safeParse(latestVisionProgramArtifact.artifact.json)
    : null;
  const latestVisionCompleteness = latestVisionProgram?.success
    ? assessProgramWeekCompleteness(latestVisionProgram.data)
    : null;
  const latestSuccessfulMdProgramJob = latestVisionProgramArtifact
    && latestVisionProgram?.success
    && latestVisionProgramArtifact.artifact.validationOk
    && latestVisionCompleteness?.isComplete
      ? latestVisionProgramArtifact.job
      : null;
  const latestFailedMdProgramJob = args.jobs.find((job) => {
    if (job.parserVersion !== 'vision-v1') return false;
    if (job.status === 'FAILED') return true;
    return job.artifacts.some((artifact) => artifact.artifactType === 'V4_OUTPUT' && !artifact.validationOk);
  }) ?? null;

  let mdParseStatus: ParseContextSummary['mdParseStatus'] = 'missing';
  if (hasExtractedMd && latestSuccessfulMdProgramJob) {
    mdParseStatus = 'succeeded';
  } else if (hasExtractedMd && latestVisionCompleteness && !latestVisionCompleteness.isComplete) {
    mdParseStatus = 'partial';
  } else if (hasExtractedMd && latestFailedMdProgramJob) {
    mdParseStatus = 'failed';
  } else if (hasExtractedMd) {
    mdParseStatus = 'available';
  } else if (latestVisionJob?.status === 'FAILED') {
    mdParseStatus = 'failed';
  }

  return {
    ...extracted,
    hasExtractedMd,
    mdParseStatus,
    persistenceSource: readPersistenceSource(args.parseProfile),
    canBackfillExtractedMd: !hasExtractedMd && args.hasSourceDocument,
    canApplyMdProgram: Boolean(
      latestSuccessfulMdProgramJob &&
      !['markdown-primary', 'markdown-merged'].includes(readPersistenceSource(args.parseProfile) || '')
    ),
    missingWeekNumbers: latestVisionCompleteness?.missingWeekNumbers ?? [],
    uploadStatus: latestUploadLifecycle?.status ?? (latestUploadJob?.status === 'SUCCESS'
      ? 'completed'
      : latestUploadJob?.status === 'FAILED'
        ? 'failed'
        : latestUploadJob?.status === 'RUNNING'
          ? 'processing'
          : null),
    uploadStage: latestUploadLifecycle?.stage ?? null,
    uploadFailureReason: latestUploadLifecycle?.failureReason ?? null,
    uploadWeekCount: latestUploadLifecycle?.weekCount ?? null,
    uploadSessionCount: latestUploadLifecycle?.sessionCount ?? null,
  };
}

function normalizeMarkdownBlock(value: string | null | undefined) {
  return String(value || "").trim();
}

function readPersistenceSource(parseProfile: unknown): string | null {
  if (!parseProfile || typeof parseProfile !== 'object') return null;
  const parserPipeline = (parseProfile as { parser_pipeline?: { persistence_source?: unknown } }).parser_pipeline;
  return typeof parserPipeline?.persistence_source === 'string' ? parserPipeline.persistence_source : null;
}

function toIsoString(value: string | Date) {
  if (typeof value === "string") return value;
  return value.toISOString();
}
