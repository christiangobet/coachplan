import test from "node:test";
import assert from "node:assert/strict";

const {
  buildCalendarDayDetailsHref,
  getDayLogEntryCopy,
  getStravaPanelActions,
} = await import(new URL("../src/lib/athlete-flow-ui.ts", import.meta.url).href);

test("getDayLogEntryCopy returns focused CTA copy for each day status", () => {
  assert.deepEqual(getDayLogEntryCopy("OPEN"), {
    buttonLabel: "Log today's workout",
    helperText: "Open the log here or jump into the calendar day card for full details.",
    panelLabel: "Today's workout log",
  });

  assert.deepEqual(getDayLogEntryCopy("PARTIAL"), {
    buttonLabel: "Finish today's log",
    helperText: "Review what synced in, then finish the missing workout details.",
    panelLabel: "Finish today's workout log",
  });

  assert.deepEqual(getDayLogEntryCopy("DONE"), {
    buttonLabel: "Review today's log",
    helperText: "Everything is saved. Reopen the log if you need to adjust anything.",
    panelLabel: "Review today's workout log",
  });

  assert.deepEqual(getDayLogEntryCopy("MISSED"), {
    buttonLabel: "Reopen and log today",
    helperText: "Open the log to add what happened or keep the day marked as missed.",
    panelLabel: "Reopen today's workout log",
  });
});

test("buildCalendarDayDetailsHref preserves plan, date, and anchor", () => {
  assert.equal(
    buildCalendarDayDetailsHref("2026-03-14", "plan_123"),
    "/calendar?plan=plan_123&date=2026-03-14#day-details-card"
  );
});

test("getStravaPanelActions hides reconnect from the steady-state connected flow", () => {
  assert.deepEqual(getStravaPanelActions(false), ["connect"]);
  assert.deepEqual(getStravaPanelActions(true), ["sync", "disconnect"]);
});
