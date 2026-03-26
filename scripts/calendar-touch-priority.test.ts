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

test("calendar month day links use route state instead of hash targeting", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  assert.match(source, /const dayHref = buildCalendarHref\(monthStart, selectedPlan\.id, key, returnToParam\);/);
  assert.doesNotMatch(source, /const dayHref = `\$\{buildCalendarHref\(monthStart, selectedPlan\.id, key, returnToParam\)\}#day-details-card`;/);
});

test("calendar css keeps the day card in the side column on tablet widths", async () => {
  const source = await readWorkspaceFile("src/app/calendar/calendar.css");
  const tabletBlockMatch = source.match(/@media \(min-width: 769px\) \{[\s\S]*?\.cal-page\.cal-day-open \.cal-right \{\s*display:\s*block;[\s\S]*?\n\}/);

  assert.match(source, /@media \(min-width: 769px\)/);
  assert.match(source, /\.cal-page\.cal-day-open \.dash-grid \{\s*grid-template-columns:/);
  assert.match(source, /\.cal-page\.cal-day-open \.cal-right \{\s*display:\s*block;/);
  assert.ok(tabletBlockMatch);
  assert.doesNotMatch(tabletBlockMatch?.[0] ?? "", /@media \(min-width: 901px\)/);
});

test("calendar close affordance stays visible outside the phone overlay", async () => {
  const source = await readWorkspaceFile("src/app/calendar/calendar.css");

  assert.match(source, /\.cal-detail-close \{\s*display:\s*inline-flex;/);
  assert.doesNotMatch(source, /@media \(min-width: 769px\)[\s\S]*?\.cal-detail-close \{\s*display:\s*none;/);
  assert.match(source, /@media \(max-width: 768px\)[\s\S]*?\.cal-day-details-card\.is-open \.cal-detail-close \{\s*display:\s*inline-flex;/);
});

test("calendar month layout opens from resolved selected date state", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  assert.match(source, /const selectedDateKey = parsedRequestedDate \? dateKey\(parsedRequestedDate\) : null;/);
  assert.match(source, /const highlightedDateKey = selectedDateKey \|\| dateKey\(defaultSelectedDate\);/);
  assert.match(source, /className=\{`dash cal-page\$\{!isWeekView \? ' cal-month-view' : ''\}\$\{selectedDateKey && !isWeekView \? ' cal-day-open' : ''\}`\}/);
  assert.match(source, /\{selectedDateKey && !isWeekView && <div id="day-details-card"/);
  assert.match(source, /buildCalendarHref\(addMonths\(monthStart, -1\), selectedPlan\.id, selectedDateKey, returnToParam\)/);
  assert.match(source, /const monthToggleHref = buildCalendarHref\(/);
  assert.match(source, /const selectedIsPastOrToday = selectedDateKey \? selectedDate\.getTime\(\) <= today\.getTime\(\) : false;/);
  assert.match(source, /const selectedExternalActivityRows = selectedDateKey && selectedIsPastOrToday \?/);
  assert.doesNotMatch(source, /buildCalendarHref\(.*highlightedDateKey.*returnToParam\)/);
  assert.doesNotMatch(source, /buildWeekHref\(.*highlightedDateKey.*returnToParam\)/);
});

test("calendar month close link clears date on the calendar route", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  assert.match(source, /const collapseCardHref = buildCalendarHref\(monthStart, selectedPlan\.id, null, returnToParam\);/);
  assert.doesNotMatch(source, /const collapseCardHref = dashboardReturnHref \?\? buildCalendarHref\(monthStart, selectedPlan\.id, null, returnToParam\);/);
  assert.match(source, /<Link className="cal-detail-close" href=\{collapseCardHref\} aria-label="Close selected day panel">/);
  assert.doesNotMatch(source, /href=\{dashboardReturnHref\}/);
});

test("calendar week view keeps week and selected date aligned across entry and pagination", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  assert.match(source, /const selectedDate = selectedDateKey \? parsedRequestedDate! : defaultSelectedDate;/);
  assert.match(source, /const fallbackWeekMonday = parsedWeekParam \? getWeekMonday\(parsedWeekParam\) : getWeekMonday\(selectedDate\);/);
  assert.match(source, /const selectedWeekMonday = selectedDateKey \? getWeekMonday\(selectedDate\) : fallbackWeekMonday;/);
  assert.match(source, /\? \(selectedDateKey \? selectedWeekMonday : fallbackWeekMonday\)/);
  assert.match(source, /const prevWeekSelectedDateKey = selectedDateKey \? dateKey\(addWeeks\(selectedDate, -1\)\) : null;/);
  assert.match(source, /const nextWeekSelectedDateKey = selectedDateKey \? dateKey\(addWeeks\(selectedDate, 1\)\) : null;/);
  assert.match(source, /const weekViewHref = buildWeekHref\(selectedWeekMonday, selectedPlan\.id, selectedDateKey, returnToParam\);/);
  assert.match(source, /const prevWeekHref = buildWeekHref\(addWeeks\(weekMonday, -1\), selectedPlan\.id, prevWeekSelectedDateKey, returnToParam\);/);
  assert.match(source, /const nextWeekHref = buildWeekHref\(addWeeks\(weekMonday, 1\), selectedPlan\.id, nextWeekSelectedDateKey, returnToParam\);/);
  assert.match(source, /href=\{weekViewHref\}/);
});

test("calendar month toggle stays aligned with the selected date context", async () => {
  const source = await readWorkspaceFile("src/app/calendar/page.tsx");

  const monthToggleHrefIndex = source.indexOf("const monthToggleHref = buildCalendarHref(");
  const monthToggleLinkIndex = source.indexOf("href={monthToggleHref}", monthToggleHrefIndex);

  assert.notEqual(monthToggleHrefIndex, -1);
  assert.notEqual(monthToggleLinkIndex, -1);
  assert.ok(monthToggleHrefIndex < monthToggleLinkIndex);
  assert.match(
    source,
    /const monthToggleHref = buildCalendarHref\(\s*getMonthStart\(selectedDateKey \? selectedDate : \(isWeekView \? weekMonday : monthStart\)\),\s*selectedPlan\.id,\s*selectedDateKey,\s*returnToParam\s*\);/
  );
  assert.match(source, /href=\{monthToggleHref\}/);
});
