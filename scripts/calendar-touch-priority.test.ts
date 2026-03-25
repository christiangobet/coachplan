import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

async function readWorkspaceFile(relativePath: string) {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

test("calendar page resolves the default view from device context only when no explicit view is provided", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  assert.match(source, /function resolveCalendarDefaultView/);
  assert.match(source, /function resolveCalendarRequestedView/);
  assert.match(source, /if \(typeof view === "string"\) return view;/);
  assert.match(source, /isAppleTouchUserAgent\(userAgent\) \? "week" : "month"/);
  assert.match(source, /params\.set\("view", "month"\);/);
});

test("client runtime exposes narrow Apple touch detection helpers", async () => {
  const source = await readWorkspaceFile("src/lib/client-runtime.ts");

  assert.match(source, /function isAppleTouchDevice/);
  assert.match(source, /function isPhoneViewport/);
  assert.match(source, /function isTabletViewport/);
});
