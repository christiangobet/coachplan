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

test("calendar day tap handler only hijacks touches on phone-sized viewports", async () => {
  const source = await readWorkspaceFile("src/components/CalendarDayTapHandler.tsx");

  assert.match(source, /import \{ isPhoneViewport \} from ['"]@\/lib\/client-runtime['"];?/);
  const helperIndex = source.indexOf("const shouldHandleTouch = () =>");
  const monthViewIndex = source.indexOf("document.querySelector('.cal-page.cal-month-view')");
  const touchStartIndex = source.indexOf("document.addEventListener('touchstart'");
  const touchEndIndex = source.indexOf("document.addEventListener('touchend'");
  const routerPushIndex = source.indexOf("router.push(href);");
  const onTouchStartStart = source.indexOf("const onTouchStart");
  const onTouchEndStart = source.indexOf("const onTouchEnd");
  const attachIndex = source.indexOf("// Attach to document");
  const onTouchStartBlock = source.slice(onTouchStartStart, onTouchEndStart);
  const onTouchEndBlock = source.slice(onTouchEndStart, attachIndex);

  assert.notEqual(helperIndex, -1);
  assert.notEqual(monthViewIndex, -1);
  assert.notEqual(touchStartIndex, -1);
  assert.notEqual(touchEndIndex, -1);
  assert.notEqual(routerPushIndex, -1);
  assert.match(
    source,
    /const shouldHandleTouch = \(\) =>\s*isPhoneViewport\(\) && Boolean\(document\.querySelector\('\.cal-page\.cal-month-view'\)\);/
  );
  assert.ok(helperIndex < touchStartIndex);
  assert.ok(helperIndex < touchEndIndex);
  assert.ok(monthViewIndex > helperIndex);
  assert.match(onTouchStartBlock, /shouldHandleTouch\(\)/);
  assert.match(onTouchEndBlock, /shouldHandleTouch\(\)/);
  assert.match(onTouchEndBlock, /e\.preventDefault\(\);/);
  assert.match(onTouchEndBlock, /router\.push\(href\);/);
  assert.ok(onTouchEndBlock.indexOf("shouldHandleTouch()") < onTouchEndBlock.indexOf("e.preventDefault();"));
  assert.ok(onTouchEndBlock.indexOf("shouldHandleTouch()") < onTouchEndBlock.indexOf("router.push(href);"));
  assert.ok(touchStartIndex < touchEndIndex);
});

test("calendar css only disables day links at the narrow phone breakpoint", async () => {
  const source = await readWorkspaceFile("src/app/calendar/calendar.css");

  const narrowStart = source.indexOf("@media (max-width: 767px)");
  const broadStart = source.indexOf("@media (max-width: 768px)");
  const nextMediaStart = source.indexOf("@media (max-width: 900px)", broadStart);

  assert.notEqual(narrowStart, -1);
  assert.notEqual(broadStart, -1);
  assert.ok(narrowStart < broadStart);

  const narrowBlock = source.slice(narrowStart, broadStart);
  const broadBlock = source.slice(broadStart, nextMediaStart === -1 ? undefined : nextMediaStart);

  assert.match(narrowBlock, /\.cal-page\.cal-month-view\s+\.cal-day-hit\s*\{\s*pointer-events:\s*none;/);
  assert.doesNotMatch(broadBlock, /\.cal-day-hit\s*\{\s*pointer-events:\s*none;/);
});

test("calendar page shell marks month view explicitly when not in week view", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  const shellIndex = source.indexOf("className={`dash cal-page");
  const monthViewIndex = source.indexOf("!isWeekView ? ' cal-month-view' : ''");

  assert.notEqual(shellIndex, -1);
  assert.notEqual(monthViewIndex, -1);
  assert.ok(shellIndex < monthViewIndex);
});
