import { promises as fs } from "node:fs";
import path from "node:path";

import { scoreProgramAgainstGold, type GoldCorpusCandidateResult, type GoldCorpusEntry } from "../src/lib/parsing/gold-corpus.ts";

type CorpusRunSummary = {
  parser: string;
  entries: number;
  overall: number;
  averageLatencyMs: number;
  averageCostUsd: number;
};

async function main() {
  const corpusDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), "scripts", "parser-gold-corpus");

  const dirEntries = await safeReadDir(corpusDir);
  const caseDirs = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => path.join(corpusDir, entry.name));
  if (caseDirs.length === 0) {
    console.error(`No gold corpus cases found in ${corpusDir}`);
    process.exit(1);
  }

  const summaries = new Map<string, CorpusRunSummary>();

  for (const caseDir of caseDirs) {
    const expectedPath = path.join(caseDir, "expected.json");
    const actualDir = path.join(caseDir, "actual");
    const expected = JSON.parse(await fs.readFile(expectedPath, "utf8")) as GoldCorpusEntry;
    const actualFiles = (await safeReadDir(actualDir))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    for (const actualFile of actualFiles) {
      const parser = actualFile.replace(/\.json$/, "");
      const actual = JSON.parse(await fs.readFile(path.join(actualDir, actualFile), "utf8")) as GoldCorpusCandidateResult;
      const score = scoreProgramAgainstGold(expected, actual);
      const current = summaries.get(parser) ?? {
        parser,
        entries: 0,
        overall: 0,
        averageLatencyMs: 0,
        averageCostUsd: 0,
      };
      current.entries += 1;
      current.overall += score.overall;
      current.averageLatencyMs += score.latencyMs;
      current.averageCostUsd += score.estimatedCostUsd;
      summaries.set(parser, current);
    }
  }

  const rows = [...summaries.values()]
    .map((summary) => ({
      parser: summary.parser,
      entries: summary.entries,
      overall: Number((summary.overall / summary.entries).toFixed(3)),
      averageLatencyMs: Number((summary.averageLatencyMs / summary.entries).toFixed(1)),
      averageCostUsd: Number((summary.averageCostUsd / summary.entries).toFixed(4)),
    }))
    .sort((a, b) => b.overall - a.overall);

  console.log(JSON.stringify({ corpusDir, parsers: rows }, null, 2));
}

async function safeReadDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

void main();
