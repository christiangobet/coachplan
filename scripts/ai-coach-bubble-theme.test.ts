import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("athlete AI bubbles use a softer visual treatment than the coach header", async () => {
  const source = await readWorkspaceFile("src/app/plans/plans.css");

  assert.match(source, /--ai-athlete-bubble-bg:/);
  assert.match(source, /--ai-athlete-bubble-text:/);
  assert.match(source, /\.ai-widget-bubble--athlete\s*\{[\s\S]*background:\s*var\(--ai-athlete-bubble-bg\)/);
  assert.match(source, /\.ai-widget-bubble--athlete\s*\{[\s\S]*color:\s*var\(--ai-athlete-bubble-text\)/);
  assert.match(source, /\.ai-widget-bubble--athlete\s*\{[\s\S]*border:\s*1px solid var\(--ai-athlete-bubble-border\)/);
});

test("dark mode defines dedicated softer athlete bubble colors", async () => {
  const source = await readWorkspaceFile("src/app/plans/plans.css");

  assert.match(source, /\[data-theme="dark"\][\s\S]*--ai-athlete-bubble-bg:/);
  assert.match(source, /\[data-theme="dark"\][\s\S]*--ai-athlete-bubble-text:/);
  assert.match(source, /\.pcal-ai-turn\.role-athlete\s*\{[\s\S]*background:\s*var\(--ai-athlete-bubble-bg\)/);
});
