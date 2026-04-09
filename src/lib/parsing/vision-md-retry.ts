import { chunkMd, type MdChunk } from "./md-chunker.ts";
import type { ProgramJsonV1 } from "../schemas/program-json-v1.ts";
import { alignProgramWeeksToExpectedChunk } from "./v4-week-alignment.ts";
import { mergeWeeksFromPasses } from "./v4-pass-strategy.ts";

export type VisionMdChunkParser = (chunk: MdChunk) => Promise<ProgramJsonV1 | null>;

export type VisionMdChunkOptions = {
  signal?: AbortSignal;
};

/**
 * Parse a markdown chunk, then retry only missing weeks individually (single-week chunks).
 * Replaces the old recursive [3, 2, 1] retry cascade, capping worst-case at
 * 1 (initial) + N (one per missing week) calls, where N <= chunk size (usually 5).
 */
export async function runVisionMdChunkWithRetries(
  chunk: MdChunk,
  parseChunk: VisionMdChunkParser,
  options?: VisionMdChunkOptions,
): Promise<ProgramJsonV1 | null> {
  if (options?.signal?.aborted) return null;

  const initial = await parseAndAlignChunk(chunk, parseChunk);

  if (initial && hasAllExpectedWeeks(initial, chunk.weekNumbers)) {
    return initial;
  }

  // Determine which week numbers are still missing
  const parsedWeekNumbers = new Set(initial?.weeks.map((w) => w.week_number) ?? []);
  const missingWeekNumbers = chunk.weekNumbers.filter((n) => !parsedWeekNumbers.has(n));

  if (missingWeekNumbers.length === 0) {
    return initial;
  }

  // Retry each missing week individually (sequential to keep concurrency bounded)
  const recoveredPrograms: ProgramJsonV1[] = initial ? [initial] : [];

  for (const weekNumber of missingWeekNumbers) {
    if (options?.signal?.aborted) break;

    const singleWeekChunks = chunkMd(chunk.text, 1).filter(
      (c) => c.weekNumbers.includes(weekNumber),
    );
    if (singleWeekChunks.length === 0) continue;

    const singleChunk = singleWeekChunks[0];
    try {
      const result = await parseAndAlignChunk(singleChunk, parseChunk);
      if (result) {
        recoveredPrograms.push(result);
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) break;
      console.warn("[VisionMdRetry] single-week retry failed", { weekNumber, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (recoveredPrograms.length === 0) return null;
  if (recoveredPrograms.length === 1) return recoveredPrograms[0];

  const mergedWeeks = mergeWeeksFromPasses(recoveredPrograms.map((p) => ({ data: p })));
  const inferredPlanLengthWeeks = mergedWeeks.reduce((max, w) => (w.week_number > max ? w.week_number : max), 0);

  return {
    program: {
      ...recoveredPrograms[0].program,
      plan_length_weeks: Math.max(
        recoveredPrograms[0].program.plan_length_weeks ?? 0,
        inferredPlanLengthWeeks,
      ),
    },
    weeks: mergedWeeks,
    quality_checks: {
      weeks_detected: mergedWeeks.length,
      missing_days: [],
      anomalies: [],
    },
  };
}

async function parseAndAlignChunk(
  chunk: MdChunk,
  parseChunk: VisionMdChunkParser,
) {
  const parsed = await parseChunk(chunk);
  if (!parsed) return null;
  return alignProgramWeeksToExpectedChunk(parsed, chunk.weekNumbers);
}

function hasAllExpectedWeeks(program: ProgramJsonV1, expectedWeekNumbers: number[]) {
  if (expectedWeekNumbers.length === 0) return true;
  const seen = new Set(program.weeks.map((week) => week.week_number));
  return expectedWeekNumbers.every((weekNumber) => seen.has(weekNumber));
}
