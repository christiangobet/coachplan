import test from "node:test";
import assert from "node:assert/strict";
import { chunkMd, extractSupplementary } from "../src/lib/parsing/md-chunker.ts";

const SAMPLE_MD = `## Glossary
| Code | Full Description |
| T2 | 2×10min tempo @ 7:30/mile |

## Strength & Conditioning
A1. Single-leg squat — 3×8 each side.

## Trainer Notes
Key phase: base building.

## Week 1
| Day | Session | Distance | Notes |
| Mon | Easy run | 8km | Zone 2 |
| Tue | T2 session | 14km | Key |

## Week 2
| Day | Session | Distance | Notes |
| Mon | Rest | — | — |
| Wed | T2 session | 12km | Key |

## Week 3
| Day | Session | Distance | Notes |
| Mon | Long run | 20km | Easy pace |
`;

test("extractSupplementary returns all three supplementary sections", () => {
  const sup = extractSupplementary(SAMPLE_MD);
  assert.ok(sup.includes("## Glossary"));
  assert.ok(sup.includes("## Strength & Conditioning"));
  assert.ok(sup.includes("## Trainer Notes"));
  assert.ok(!sup.includes("## Week 1"));
});

test("extractSupplementary handles missing sections gracefully", () => {
  const md = `## Glossary\n| Code | Full |\n\n## Week 1\n| Day | Session |\n`;
  const sup = extractSupplementary(md);
  assert.ok(sup.includes("## Glossary"));
  assert.ok(!sup.includes("## Strength & Conditioning"));
  assert.ok(!sup.includes("## Week 1"));
});

test("chunkMd returns single chunk when plan has fewer weeks than chunkSize", () => {
  const chunks = chunkMd(SAMPLE_MD, 5);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].weekNumbers.includes(1));
  assert.ok(chunks[0].weekNumbers.includes(2));
  assert.ok(chunks[0].weekNumbers.includes(3));
});

test("chunkMd splits into multiple chunks when plan exceeds chunkSize", () => {
  let bigMd = "## Glossary\n| Code | Full |\n\n";
  for (let i = 1; i <= 12; i++) {
    bigMd += `## Week ${i}\n| Day | Session |\n| Mon | Easy run |\n\n`;
  }
  const chunks = chunkMd(bigMd, 5);
  assert.equal(chunks.length, 3); // weeks 1-5, 6-10, 11-12
  assert.deepEqual(chunks[0].weekNumbers, [1, 2, 3, 4, 5]);
  assert.deepEqual(chunks[1].weekNumbers, [6, 7, 8, 9, 10]);
  assert.deepEqual(chunks[2].weekNumbers, [11, 12]);
});

test("every chunk includes supplementary sections as prefix", () => {
  let bigMd = "## Glossary\n| Code | Full |\n\n## Trainer Notes\nBase phase.\n\n";
  for (let i = 1; i <= 6; i++) {
    bigMd += `## Week ${i}\n| Day | Session |\n| Mon | Easy |\n\n`;
  }
  const chunks = chunkMd(bigMd, 3);
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.ok(chunk.text.startsWith("## Glossary"), `chunk for weeks ${chunk.weekNumbers} missing Glossary prefix`);
    assert.ok(chunk.text.includes("## Trainer Notes"), `chunk for weeks ${chunk.weekNumbers} missing Trainer Notes`);
  }
});

test("chunkMd single-week mode produces one chunk per week", () => {
  const chunks = chunkMd(SAMPLE_MD, 1);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0].weekNumbers, [1]);
  assert.deepEqual(chunks[1].weekNumbers, [2]);
  assert.deepEqual(chunks[2].weekNumbers, [3]);
});
