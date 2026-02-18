import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function pickArg(args, ...keys) {
  for (const key of keys) {
    if (args[key] !== undefined) return args[key];
  }
  return undefined;
}

function normalizeProfile(raw) {
  const cleaned = String(raw || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

const cli = parseArgs(process.argv.slice(2));
const profile = normalizeProfile(pickArg(cli, "profile") || process.env.AUDIT_PROFILE || "default");
const BASE_URL = pickArg(cli, "baseUrl", "base-url") || process.env.BASE_URL || "http://localhost:3001";
const START_PATH = pickArg(cli, "startPath", "start-path") || process.env.AUDIT_START_PATH || "/";
const OUT_DIR = pickArg(cli, "outDir", "out-dir") || process.env.AUDIT_OUT_DIR || "artifacts/audit-shots-manual";
const STORAGE_STATE =
  pickArg(cli, "storageState", "storage-state") ||
  process.env.PLAYWRIGHT_STORAGE_STATE ||
  `.auth/${profile}-storage.json`;

const steps = [
  { id: "01-landing", hint: "Landing or initial entry point" },
  { id: "02-upload-entry", hint: "Upload plan screen (before selecting file)" },
  { id: "03-parse-review", hint: "Parsed review output after upload/parse" },
  { id: "04-today", hint: "Today dashboard state" },
  { id: "05-week-view", hint: "Calendar/week log view" },
  { id: "06-adapt-action", hint: "Adaptation UI (adjust/missed/tired/travel flow)" },
  { id: "07-weekly-feedback", hint: "Weekly feedback/progress summary" },
];

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const rl = readline.createInterface({ input, output });
  const resolvedOutDir = path.resolve(OUT_DIR, "desktop");
  await fs.mkdir(resolvedOutDir, { recursive: true });

  const contextOptions = { viewport: { width: 1440, height: 900 } };
  const storageStatePath = path.resolve(STORAGE_STATE);
  if (await fileExists(storageStatePath)) contextOptions.storageState = storageStatePath;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(new URL(START_PATH, BASE_URL).toString(), { waitUntil: "domcontentloaded" });

  console.log("");
  console.log("Manual capture started.");
  console.log("Use the opened browser window to navigate each step.");
  console.log("Press Enter to capture, type 's' then Enter to skip, type 'q' then Enter to quit.");
  console.log(`Output: ${resolvedOutDir}`);
  console.log("");

  try {
    for (const step of steps) {
      const prompt = `${step.id} - ${step.hint}\nCapture now? [Enter=snap | s=skip | q=quit]: `;
      const answer = (await rl.question(prompt)).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "s") {
        console.log(`Skipped ${step.id}`);
        continue;
      }

      const outputPath = path.join(resolvedOutDir, `${step.id}.png`);
      await page.screenshot({ path: outputPath, fullPage: true });
      console.log(`Captured ${step.id} -> ${outputPath}`);
      console.log(`URL: ${page.url()}`);
    }
  } finally {
    rl.close();
    await context.close();
    await browser.close();
  }

  console.log("Manual capture complete.");
}

run().catch((error) => {
  console.error("capture-audit-manual failed:", error);
  process.exitCode = 1;
});
