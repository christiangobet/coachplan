import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeTableLabel,
  extractWeekNumber,
  normalizePlanText
} from '../src/lib/plan-parser-i18n.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const germanFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'plan-i18n', 'german-week-cells.json'), 'utf8')
);
const frenchFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'plan-i18n', 'french-week-cells.json'), 'utf8')
);

function runCanonicalLabelTests() {
  const cases = [
    [germanFixture.header_tokens[1], 'MONDAY'],
    [frenchFixture.header_tokens[1], 'MONDAY'],
    [germanFixture.header_tokens[2], 'TUESDAY'],
    [frenchFixture.header_tokens[2], 'TUESDAY'],
    [germanFixture.header_tokens[3], 'WEDNESDAY'],
    [frenchFixture.header_tokens[3], 'WEDNESDAY'],
    [germanFixture.header_tokens[4], 'THURSDAY'],
    [frenchFixture.header_tokens[4], 'THURSDAY'],
    [germanFixture.header_tokens[5], 'FRIDAY'],
    [frenchFixture.header_tokens[5], 'FRIDAY'],
    [germanFixture.header_tokens[6], 'SATURDAY'],
    [frenchFixture.header_tokens[6], 'SATURDAY'],
    [germanFixture.header_tokens[7], 'SUNDAY'],
    [frenchFixture.header_tokens[7], 'SUNDAY'],
    [germanFixture.header_tokens[0], 'WEEK'],
    [frenchFixture.header_tokens[0], 'WEEK'],
    ['KW', 'WEEK'],
    ['Sem.', 'WEEK'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(canonicalizeTableLabel(input), expected, `canonicalizeTableLabel(${input})`);
  }
}

function runTextNormalizationTests() {
  const cases = [
    [germanFixture.cells[0], 'rest day or 45 minutes'],
    [frenchFixture.cells[0], 'rest day or 30 minutes'],
    [germanFixture.cells[1], '2 miles warm up + 6 x 400 meters'],
    [frenchFixture.cells[1], 'strength + 1 hours'],
    [germanFixture.cells[2], 'hills und threshold'],
    [frenchFixture.cells[2], 'cool down 10 minutes'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizePlanText(input), expected, `normalizePlanText(${input})`);
  }
}

function runWeekNumberTests() {
  const cases = [
    ['1', 1],
    ['Week 7', 7],
    [germanFixture.week_markers[0], 1],
    [germanFixture.week_markers[1], 2],
    [frenchFixture.week_markers[0], 3],
    [frenchFixture.week_markers[1], 4],
    ['KW 9', 9],
    ['Sem. 10', 10],
  ];

  for (const [input, expected] of cases) {
    assert.equal(extractWeekNumber(input), expected, `extractWeekNumber(${input})`);
  }

  assert.equal(extractWeekNumber('No marker'), null, 'extractWeekNumber(no marker)');
}

runCanonicalLabelTests();
runTextNormalizationTests();
runWeekNumberTests();

console.log('parser i18n tests passed');
