export function shouldUseChunkedFallback(options?: {
  expectedWeekNumbers?: number[];
}) {
  return !options?.expectedWeekNumbers || options.expectedWeekNumbers.length === 0;
}
