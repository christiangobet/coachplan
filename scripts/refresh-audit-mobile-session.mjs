import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildMobileAuditRefreshPlan, parseArgs, pickArg } from "./lib/audit-workflow.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log(`Refresh Playwright auth state, then run the mobile audit.

Usage:
  node scripts/refresh-audit-mobile-session.mjs [options]

Options:
  --profile <name>      Auth profile name stored under .auth/
  --base-url <url>      App base URL (default: http://localhost:3001)
  --start-path <path>   Route to open before login
  --out-dir <path>      Audit screenshot output directory
  --plan-id <id>        Explicit plan id for review/detail routes
  --help                Show this help message
`);
}

function runNodeScript(scriptName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, scriptName), ...args], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptName} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  if (pickArg(cli, "help", "h")) {
    printHelp();
    return;
  }

  const plan = buildMobileAuditRefreshPlan({
    profile: pickArg(cli, "profile"),
    baseUrl: pickArg(cli, "baseUrl", "base-url"),
    startPath: pickArg(cli, "startPath", "start-path"),
    outDir: pickArg(cli, "outDir", "out-dir"),
    planId: pickArg(cli, "planId", "plan-id"),
  });

  console.log(`Refreshing audit auth state for profile "${plan.profile}"...`);
  await runNodeScript("save-audit-auth-state.mjs", plan.authArgs);

  console.log("Running mobile audit capture with refreshed auth...");
  await runNodeScript("capture-audit.mjs", plan.auditArgs);
}

run().catch((error) => {
  console.error("refresh-audit-mobile-session failed:", error);
  process.exitCode = 1;
});
