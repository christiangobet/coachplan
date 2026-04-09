import type { ProgramJsonV1 } from "@/lib/schemas/program-json-v1";

export type ProgramWeekCompleteness = {
  expectedWeekCount: number;
  observedWeekNumbers: number[];
  missingWeekNumbers: number[];
  isComplete: boolean;
};

type ProgramWeekCompletenessOptions = {
  expectedWeekNumbers?: number[];
};

function uniqueSortedWeekNumbers(weeks: ProgramJsonV1["weeks"]) {
  return [...new Set(
    weeks
      .map((week) => week.week_number)
      .filter((weekNumber): weekNumber is number => Number.isFinite(weekNumber)),
  )].sort((a, b) => a - b);
}

function formatWeekRanges(weekNumbers: number[]) {
  if (weekNumbers.length === 0) return "";
  const ranges: Array<{ start: number; end: number }> = [];
  let start = weekNumbers[0];
  let end = weekNumbers[0];

  for (let index = 1; index < weekNumbers.length; index += 1) {
    const current = weekNumbers[index];
    if (current === end + 1) {
      end = current;
      continue;
    }
    ranges.push({ start, end });
    start = current;
    end = current;
  }

  ranges.push({ start, end });
  return ranges
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`))
    .join(", ");
}

export function assessProgramWeekCompleteness(
  program: Pick<ProgramJsonV1, "program" | "weeks">,
  options?: ProgramWeekCompletenessOptions,
): ProgramWeekCompleteness {
  const observedWeekNumbers = uniqueSortedWeekNumbers(program.weeks);
  const maxObservedWeek = observedWeekNumbers[observedWeekNumbers.length - 1] ?? 0;
  const normalizedExpectedWeekNumbers = [...new Set(
    (options?.expectedWeekNumbers ?? []).filter((weekNumber): weekNumber is number => Number.isFinite(weekNumber) && weekNumber > 0),
  )].sort((a, b) => a - b);
  const expectedWeekCount = Math.max(
    program.program.plan_length_weeks ?? 0,
    maxObservedWeek,
    normalizedExpectedWeekNumbers[normalizedExpectedWeekNumbers.length - 1] ?? 0,
  );
  const missingWeekNumbers: number[] = [];

  if (normalizedExpectedWeekNumbers.length > 0) {
    for (const weekNumber of normalizedExpectedWeekNumbers) {
      if (!observedWeekNumbers.includes(weekNumber)) {
        missingWeekNumbers.push(weekNumber);
      }
    }
  } else {
    for (let weekNumber = 1; weekNumber <= expectedWeekCount; weekNumber += 1) {
      if (!observedWeekNumbers.includes(weekNumber)) {
        missingWeekNumbers.push(weekNumber);
      }
    }
  }

  return {
    expectedWeekCount,
    observedWeekNumbers,
    missingWeekNumbers,
    isComplete: expectedWeekCount > 0 && missingWeekNumbers.length === 0,
  };
}

export function buildProgramWeekCompletenessWarning(
  program: Pick<ProgramJsonV1, "program" | "weeks">,
  options?: ProgramWeekCompletenessOptions,
) {
  const completeness = assessProgramWeekCompleteness(program, options);
  if (completeness.isComplete) return null;

  const expectedLabel = completeness.expectedWeekCount > 0 ? `1-${completeness.expectedWeekCount}` : "unknown";
  const missingLabel = formatWeekRanges(completeness.missingWeekNumbers);
  return {
    ...completeness,
    message: `Vision pipeline incomplete: missing weeks ${missingLabel} of expected ${expectedLabel}`,
    missingWeekRangesLabel: missingLabel,
  };
}
