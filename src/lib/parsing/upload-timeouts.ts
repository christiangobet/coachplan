function parseTimeoutMs(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 30_000) return fallback;
  return Math.floor(parsed);
}

export function resolveUploadAiCandidateTimeoutMs(
  envValue: string | undefined,
  uploadParseTimeoutMs: number,
): number {
  const defaultTimeout = uploadParseTimeoutMs;
  return parseTimeoutMs(envValue, defaultTimeout);
}
