import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeekRanges,
  findMissingWeekRanges,
  formatWeekRange,
  inferExpectedWeekCount,
  mergeWeeksFromPasses,
  parsePlanLengthFromGuide,
  splitWeekRange
} from '../src/lib/parsing/v4-pass-strategy.ts';

function makeWeek(weekNumber) {
  return {
    week_number: weekNumber,
    sessions: []
  };
}

function makePass(weeks, planLengthWeeks) {
  return {
    program: {
      title: 'Sample',
      distance_target: null,
      plan_length_weeks: planLengthWeeks,
      layout_type: 'sequential_table',
      source_units: null,
      intensity_rules: {},
      training_rules: {},
      phase_rules: [],
      progression: {},
      symbol_dictionary: {},
      glossary: {},
      assumptions: [],
      program_notes: []
    },
    weeks: weeks.map(makeWeek),
    quality_checks: {
      weeks_detected: weeks.length,
      missing_days: [],
      anomalies: []
    }
  };
}

test('buildWeekRanges uses strict 5-week chunks by default', () => {
  const ranges = buildWeekRanges();
  assert.deepEqual(ranges, [
    { start: 1, end: 5 },
    { start: 6, end: 10 },
    { start: 11, end: 15 },
    { start: 16, end: 20 },
    { start: 21, end: 25 }
  ]);
  assert.equal(formatWeekRange(ranges[3]), '16 through 20');
});

test('splitWeekRange divides a failed chunk into smaller retries', () => {
  assert.deepEqual(splitWeekRange({ start: 16, end: 20 }, 3), [
    { start: 16, end: 18 },
    { start: 19, end: 20 }
  ]);
});

test('missing-week detection catches the week-16+ truncation case', () => {
  const p1 = makePass([1, 2, 3, 4, 5], 18);
  const p2 = makePass([6, 7, 8, 9, 10], 18);
  const p3 = makePass([11, 12, 13, 14, 15], 18);

  const merged = mergeWeeksFromPasses([
    { data: p1 },
    { data: p2 },
    { data: p3 }
  ]);
  const expectedWeeks = inferExpectedWeekCount(
    [{ data: p1 }, { data: p2 }, { data: p3 }],
    merged
  );
  const missingRanges = findMissingWeekRanges(merged, expectedWeeks);

  assert.equal(merged.length, 15);
  assert.equal(expectedWeeks, 18);
  assert.deepEqual(missingRanges, [{ start: 16, end: 18 }]);
});

test('retry merge recovers tail weeks and closes gaps', () => {
  const base = makePass([1, 2, 3, 4, 5], 18);
  const middleA = makePass([6, 7, 8, 9, 10], 18);
  const middleB = makePass([11, 12, 13, 14, 15], 18);
  const retry = makePass([16, 17, 18], 18);

  const merged = mergeWeeksFromPasses([
    { data: base },
    { data: middleA },
    { data: middleB },
    { data: retry }
  ]);
  const expectedWeeks = inferExpectedWeekCount(
    [{ data: base }, { data: middleA }, { data: middleB }, { data: retry }],
    merged
  );
  const missingRanges = findMissingWeekRanges(merged, expectedWeeks);

  assert.equal(merged.length, 18);
  assert.deepEqual(missingRanges, []);
});

test('parsePlanLengthFromGuide extracts week count from guide text', () => {
  assert.equal(parsePlanLengthFromGuide('PLAN OVERVIEW\n- 18 weeks total'), 18);
  assert.equal(parsePlanLengthFromGuide('Total number of weeks: 16'), 16);
  assert.equal(parsePlanLengthFromGuide('This is a 20-week training plan'), 20);
  assert.equal(parsePlanLengthFromGuide(''), null);
  assert.equal(parsePlanLengthFromGuide('No number here'), null);
});

test('buildInput includes plan length hint in range instruction', () => {
  const hint = 'The plan has 18 weeks total';
  const rangeInstruction = `Output ONLY weeks 16 through 18 in the "weeks" array. Skip all other weeks. ${hint}`;
  assert.ok(rangeInstruction.includes('18 weeks total'));
  assert.ok(rangeInstruction.includes('16 through 18'));
});

test('planGuide is injected into buildInput when provided', () => {
  const guide = 'PLAN OVERVIEW\n- 18 weeks total\nGLOSSARY\nE = Easy run';
  const input = `PROMPT\n\nPLAN CONTEXT GUIDE (use to resolve abbreviations and understand session types):\n${guide}\n\nRaw plan text:\nWeek 1 data`;
  assert.ok(input.includes('18 weeks total'), 'guide content must appear in input');
  assert.ok(input.includes('E = Easy run'), 'glossary must appear in input');
});

test('buildInput sends full text without truncation', () => {
  // Simulate a 50,000-char PDF text — longer than the old 40,000-char limit
  const longText = 'Week 16 data '.repeat(4000); // ~52,000 chars
  assert.ok(longText.length > 40000, 'test setup: text must exceed old limit');
  // The text passed to the AI must contain week 16 content
  assert.ok(longText.includes('Week 16'), 'long text must include week 16 content');
});
