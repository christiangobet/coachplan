import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

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
const OUT_DIR = pickArg(cli, "outDir", "out-dir") || process.env.AUDIT_OUT_DIR || "artifacts/audit-shots";
const DEFAULT_STORAGE_STATE = path.resolve(`.auth/${profile}-storage.json`);
const STORAGE_STATE =
  pickArg(cli, "storageState", "storage-state") || process.env.PLAYWRIGHT_STORAGE_STATE || undefined;
const NO_AUTH = Boolean(pickArg(cli, "no-auth", "noAuth"));
const EXPLICIT_PLAN_ID = pickArg(cli, "planId", "plan-id");

function routeSet(planId) {
  const parseReviewRoute = planId ? `/plans/${planId}/review?fromUpload=1` : "/plans";
  const adaptRoute = planId ? `/plans/${planId}` : "/plans";
  return [
    ["01-landing", "/"],
    ["02-upload-entry", "/upload"],
    ["03-parse-review", parseReviewRoute],
    ["04-today", "/dashboard"],
    ["05-week-view", "/calendar"],
    ["06-adapt-action", adaptRoute],
    ["07-weekly-feedback", "/progress"],
  ];
}

const variants = [
  {
    name: "desktop",
    contextOptions: {
      viewport: { width: 1440, height: 900 },
      storageState: STORAGE_STATE,
    },
  },
  {
    name: "mobile",
    contextOptions: {
      ...devices["iPhone 13"],
      storageState: STORAGE_STATE,
    },
  },
];

async function run() {
  let storageStateToUse = STORAGE_STATE;
  if (!storageStateToUse && !NO_AUTH) {
    try {
      await fs.access(DEFAULT_STORAGE_STATE);
      storageStateToUse = DEFAULT_STORAGE_STATE;
    } catch {
      storageStateToUse = undefined;
    }
  }

  const browser = await chromium.launch({ headless: true });
  const resolvedOutDir = path.resolve(OUT_DIR);

  try {
    for (const variant of variants) {
      const contextOptions = {
        ...variant.contextOptions,
        storageState: storageStateToUse,
      };
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const variantDir = path.join(resolvedOutDir, variant.name);
      await fs.mkdir(variantDir, { recursive: true });
      const planId = await resolvePlanId(page);
      const routes = routeSet(planId);
      console.log(`[${variant.name}] planId=${planId || "none"}`);

      for (const [name, route] of routes) {
        const url = new URL(route, BASE_URL).toString();
        await page.goto(url, { waitUntil: "networkidle" });
        await page.screenshot({
          path: path.join(variantDir, `${name}.png`),
          fullPage: true,
        });
        console.log(`[${variant.name}] captured ${name} -> ${url}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`Saved screenshots to: ${resolvedOutDir}`);
  if (NO_AUTH) {
    console.log("Captured without auth state (--no-auth).");
  } else if (!storageStateToUse) {
    console.log("No auth storage state found. Protected routes may have captured sign-in screens.");
    console.log(`Run: npm run audit:auth -- --profile ${profile}`);
  }
}

async function resolvePlanId(page) {
  if (EXPLICIT_PLAN_ID) return String(EXPLICIT_PLAN_ID);
  try {
    const res = await page.request.get(new URL("/api/plans", BASE_URL).toString());
    if (!res.ok()) return null;
    const data = await res.json();
    const rawPlans = Array.isArray(data?.plans) ? data.plans : [];
    const plans = rawPlans
      .filter((plan) => plan && typeof plan === "object")
      .filter((plan) => !plan.isTemplate)
      .map((plan) => ({
        id: typeof plan.id === "string" ? plan.id : null,
        createdAtMs: Date.parse(String(plan.createdAt || "")) || 0,
      }))
      .filter((plan) => plan.id);

    if (!plans.length) return null;
    plans.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return plans[0].id;
  } catch {
    return null;
  }
}

run().catch((error) => {
  console.error("capture-audit failed:", error);
  process.exitCode = 1;
});
