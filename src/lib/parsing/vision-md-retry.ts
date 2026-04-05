import { chunkMd, type MdChunk } from "./md-chunker.ts";
import type { ProgramJsonV1 } from "../schemas/program-json-v1.ts";
import { alignProgramWeeksToExpectedChunk } from "./v4-week-alignment.ts";
import { mergeWeeksFromPasses } from "./v4-pass-strategy.ts";

export type VisionMdChunkParser = (chunk: MdChunk) => Promise<ProgramJsonV1 | null>;

export async function runVisionMdChunkWithRetries(
  chunk: MdChunk,
  parseChunk: VisionMdChunkParser,
  retryChunkSizes: number[] = [3, 2, 1],
): Promise<ProgramJsonV1 | null> {
  const initial = await parseAndAlignChunk(chunk, parseChunk);
  if (initial && hasAllExpectedWeeks(initial, chunk.weekNumbers)) {
    return initial;
  }

  for (const retrySize of retryChunkSizes) {
    if (chunk.weekNumbers.length <= retrySize) continue;

    const subChunks = chunkMd(chunk.text, retrySize).filter((subChunk) => subChunk.weekNumbers.length > 0);
    const subPrograms = await Promise.all(
      subChunks.map((subChunk) => runVisionMdChunkWithRetries(subChunk, parseChunk, retryChunkSizes.filter((size) => size < retrySize))),
    );
    const successfulPrograms = subPrograms.filter((program): program is ProgramJsonV1 => program !== null);
    if (successfulPrograms.length === 0) continue;

    const mergedWeeks = mergeWeeksFromPasses(successfulPrograms.map((program) => ({ data: program })));
    const inferredPlanLengthWeeks = mergedWeeks.reduce((max, week) => {
      return week.week_number > max ? week.week_number : max;
    }, 0);

    const merged: ProgramJsonV1 = {
      program: {
        ...successfulPrograms[0].program,
        plan_length_weeks: Math.max(
          successfulPrograms[0].program.plan_length_weeks ?? 0,
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

    if (hasAllExpectedWeeks(merged, chunk.weekNumbers)) {
      return merged;
    }

    if (!initial) {
      return merged;
    }
  }

  return initial;
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
