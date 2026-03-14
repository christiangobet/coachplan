export const AUDIT_VARIANT_NAMES = ["desktop", "mobile"];

export function parseArgs(argv) {
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

export function pickArg(args, ...keys) {
  for (const key of keys) {
    if (args[key] !== undefined) return args[key];
  }
  return undefined;
}

export function normalizeProfile(raw) {
  const cleaned = String(raw || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

export function parseAuditVariants(raw) {
  if (!raw) return [...AUDIT_VARIANT_NAMES];

  const parsed = String(raw)
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token, index, arr) => arr.indexOf(token) === index)
    .filter((token) => AUDIT_VARIANT_NAMES.includes(token));

  return parsed.length ? parsed : [...AUDIT_VARIANT_NAMES];
}

export function getAuditNavigationWaitUntil() {
  return "domcontentloaded";
}

function pushFlag(args, flag, value) {
  if (!value) return;
  args.push(flag, value);
}

export function buildMobileAuditRefreshPlan(options) {
  const profile = normalizeProfile(options.profile);
  const authArgs = [];
  const auditArgs = [];

  if (profile !== "default") {
    authArgs.push("--profile", profile);
    auditArgs.push("--profile", profile);
  }

  pushFlag(authArgs, "--base-url", options.baseUrl);
  pushFlag(authArgs, "--start-path", options.startPath);

  pushFlag(auditArgs, "--base-url", options.baseUrl);
  pushFlag(auditArgs, "--out-dir", options.outDir);
  pushFlag(auditArgs, "--plan-id", options.planId);
  auditArgs.push("--variants", "mobile");

  return {
    profile,
    authArgs,
    auditArgs,
  };
}
