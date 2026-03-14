import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("plan detail page tracks an iPhone keyboard-open state for the AI coach", async () => {
  const source = await readWorkspaceFile("src/app/plans/[id]/page.tsx");

  assert.match(source, /isAiCoachKeyboardOpen/);
  assert.match(source, /ai_coach_keyboard_opened/);
  assert.match(source, /is-keyboard-open/);
});

test("mobile AI coach sheet defines a compact keyboard-open layout", async () => {
  const source = await readWorkspaceFile("src/app/plans/plans.css");

  assert.match(source, /\.ai-widget--mobile\.is-open\.is-keyboard-open \.ai-widget-panel/);
  assert.match(source, /\.ai-widget--mobile\.is-open\.is-keyboard-open \.ai-widget-footer/);
  assert.match(source, /padding-inline:\s*max\(16px,\s*env\(safe-area-inset-left\)\)\s+max\(16px,\s*env\(safe-area-inset-right\)\)/);
});
