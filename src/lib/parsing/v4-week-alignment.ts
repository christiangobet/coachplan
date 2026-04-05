import type { ProgramJsonV1 } from "../schemas/program-json-v1";

function isConsecutive(numbers: number[]): boolean {
  if (numbers.length === 0) return false;
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) return false;
  }
  return true;
}

export function alignProgramWeeksToExpectedChunk(
  program: ProgramJsonV1,
  expectedWeekNumbers: number[],
): ProgramJsonV1 {
  if (expectedWeekNumbers.length === 0 || program.weeks.length === 0) {
    return program;
  }

  const sortedExpected = [...expectedWeekNumbers].sort((a, b) => a - b);
  const sortedObserved = [...program.weeks]
    .map((week) => week.week_number)
    .sort((a, b) => a - b);

  const maxExpectedWeek = sortedExpected[sortedExpected.length - 1] ?? 0;
  const nextPlanLength = Math.max(program.program.plan_length_weeks ?? 0, maxExpectedWeek);
  const alreadyAligned = sortedObserved.every((weekNumber) => sortedExpected.includes(weekNumber));
  if (alreadyAligned) {
    return {
      ...program,
      program: {
        ...program.program,
        plan_length_weeks: nextPlanLength,
      },
    };
  }

  const canRemapByPosition =
    program.weeks.length === sortedExpected.length &&
    isConsecutive(sortedObserved);

  if (!canRemapByPosition) {
    return {
      ...program,
      program: {
        ...program.program,
        plan_length_weeks: nextPlanLength,
      },
    };
  }

  const sortedWeeks = [...program.weeks].sort((a, b) => a.week_number - b.week_number);
  const remappedWeeks = sortedWeeks.map((week, index) => ({
    ...week,
    week_number: sortedExpected[index],
  }));

  return {
    ...program,
    program: {
      ...program.program,
      plan_length_weeks: nextPlanLength,
    },
    weeks: remappedWeeks,
    quality_checks: {
      ...program.quality_checks,
      weeks_detected: remappedWeeks.length,
    },
  };
}
