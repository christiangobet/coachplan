import type { UploadParserKey, UploadParserRun } from "./upload-orchestrator";

type TimedCandidateOptions = {
  parser: UploadParserKey;
  kind: "program" | "legacy";
  timeoutMs: number;
  timeoutMessage: string;
  run: () => Promise<UploadParserRun>;
  onTimeout?: () => Promise<void> | void;
};

export async function runTimedUploadCandidate(
  options: TimedCandidateOptions,
): Promise<UploadParserRun> {
  const { parser, kind, timeoutMs, timeoutMessage, run, onTimeout } = options;

  try {
    return await withTimeout(run(), timeoutMs, timeoutMessage);
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    if (warning === timeoutMessage) {
      await onTimeout?.();
    }

    if (kind === "legacy") {
      return {
        parser,
        kind,
        viable: false,
        quality: { score: 0, weekCount: 0, dayCoverage: 0 },
        data: null,
        warning,
      };
    }

    return {
      parser,
      kind,
      viable: false,
      quality: {
        score: 0,
        weekCount: 0,
        dayCoverage: 0,
        notesCoverage: 0,
        structureCoverage: 0,
        sessionCount: 0,
      },
      data: null,
      warning,
    };
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
