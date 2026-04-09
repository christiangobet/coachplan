import type { UploadParserKey, UploadParserRun } from '@/lib/parsing/upload-orchestrator';
import type { ProgramJsonV1 } from '../schemas/program-json-v1.ts';
import { assessProgramWeekCompleteness } from './program-week-completeness.ts';

export type MarkdownUploadFailureReason =
  | 'vision_not_enabled'
  | 'extracted_md_not_attempted'
  | 'extracted_md_missing'
  | 'markdown_program_missing'
  | 'markdown_program_invalid'
  | 'markdown_program_partial';

export type MarkdownUploadPipelineStatus = {
  uploadStatus: 'accepted' | 'rejected';
  failureReason: MarkdownUploadFailureReason | null;
  visionEnabled: boolean;
  visionAttempted: boolean;
  hasExtractedMd: boolean;
  mdParseStatus: 'missing' | 'available' | 'partial' | 'succeeded' | 'failed';
  selectedBaseParser: UploadParserKey | null;
  finalParser: UploadParserKey | null;
  resultKind: 'program' | 'legacy' | 'none';
  usedFallback: boolean;
  usedEnrichers: UploadParserKey[];
  candidateRuns: Array<{
    parser: UploadParserKey;
    kind: 'program' | 'legacy';
    viable: boolean;
    score: number;
    warning: string | null;
  }>;
  missingWeekNumbers: number[];
};

export type MarkdownUploadPipelineState = {
  hasPdf: boolean;
  visionEnabled: boolean;
  visionAttempted: boolean;
  extractedMd: string | null;
  resultKind: 'program' | 'legacy' | 'none';
  finalParser: UploadParserKey | null;
  selectedBaseParser: UploadParserKey | null;
  usedFallback: boolean;
  usedEnrichers: UploadParserKey[];
  candidateRuns: UploadParserRun[];
  program: ProgramJsonV1 | null;
};

export function evaluateMarkdownFirstUpload(state: MarkdownUploadPipelineState): {
  ok: boolean;
  status: MarkdownUploadPipelineStatus;
} {
  if (!state.hasPdf) {
    return {
      ok: true,
      status: {
        uploadStatus: 'accepted',
        failureReason: null,
        visionEnabled: state.visionEnabled,
        visionAttempted: state.visionAttempted,
        hasExtractedMd: Boolean(state.extractedMd?.trim()),
        mdParseStatus: 'missing',
        selectedBaseParser: state.selectedBaseParser,
        finalParser: state.finalParser,
        resultKind: state.resultKind,
        usedFallback: state.usedFallback,
        usedEnrichers: state.usedEnrichers,
        candidateRuns: summarizeCandidateRuns(state.candidateRuns),
        missingWeekNumbers: [],
      },
    };
  }

  let failureReason: MarkdownUploadFailureReason | null = null;
  let mdParseStatus: MarkdownUploadPipelineStatus['mdParseStatus'] = 'succeeded';
  const hasExtractedMd = Boolean(state.extractedMd?.trim());
  const completeness = state.program ? assessProgramWeekCompleteness(state.program) : null;

  if (!state.visionEnabled) {
    failureReason = 'vision_not_enabled';
    mdParseStatus = 'missing';
  } else if (!state.visionAttempted) {
    failureReason = 'extracted_md_not_attempted';
    mdParseStatus = 'missing';
  } else if (!hasExtractedMd) {
    failureReason = 'extracted_md_missing';
    mdParseStatus = 'failed';
  } else if (state.resultKind !== 'program') {
    failureReason = 'markdown_program_missing';
    mdParseStatus = 'failed';
  } else if (state.finalParser !== 'vision') {
    failureReason = 'markdown_program_invalid';
    mdParseStatus = 'failed';
  } else if (completeness && !completeness.isComplete) {
    failureReason = 'markdown_program_partial';
    mdParseStatus = 'partial';
  }

  const status: MarkdownUploadPipelineStatus = {
    uploadStatus: failureReason ? 'rejected' : 'accepted',
    failureReason,
    visionEnabled: state.visionEnabled,
    visionAttempted: state.visionAttempted,
    hasExtractedMd,
    mdParseStatus: failureReason && hasExtractedMd ? mdParseStatus : (hasExtractedMd ? 'succeeded' : mdParseStatus),
    selectedBaseParser: state.selectedBaseParser,
    finalParser: state.finalParser,
    resultKind: state.resultKind,
    usedFallback: state.usedFallback,
    usedEnrichers: state.usedEnrichers,
    candidateRuns: summarizeCandidateRuns(state.candidateRuns),
    missingWeekNumbers: completeness?.missingWeekNumbers ?? [],
  };

  return { ok: !failureReason, status };
}

function summarizeCandidateRuns(candidateRuns: UploadParserRun[]): MarkdownUploadPipelineStatus['candidateRuns'] {
  return candidateRuns.map((run) => ({
    parser: run.parser,
    kind: run.kind,
    viable: run.viable,
    score: run.quality.score,
    warning: run.warning,
  }));
}
