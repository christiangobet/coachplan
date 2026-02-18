import fs from "node:fs/promises";
import path from "node:path";
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
const STORAGE_STATE_PATH =
  pickArg(cli, "storageState", "storage-state") ||
  process.env.PLAYWRIGHT_STORAGE_STATE ||
  `.auth/${profile}-storage.json`;

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => resolve());
  });
}

async function run() {
  const outputPath = path.resolve(STORAGE_STATE_PATH);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const url = new URL(START_PATH, BASE_URL).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`Opened ${url}`);
  console.log("Log in in the browser window, then press Enter in this terminal to save session.");

  await waitForEnter();
  await context.storageState({ path: outputPath });

  await browser.close();
  console.log(`Saved auth state to: ${outputPath}`);
}

run().catch((error) => {
  console.error("save-audit-auth-state failed:", error);
  process.exitCode = 1;
});
