import type { DayStatus } from "@/lib/day-status";

export function getDayLogEntryCopy(dayStatus: DayStatus) {
  if (dayStatus === "PARTIAL") {
    return {
      buttonLabel: "Finish today's log",
      helperText: "Review what synced in, then finish the missing workout details.",
      panelLabel: "Finish today's workout log",
    };
  }

  if (dayStatus === "DONE") {
    return {
      buttonLabel: "Review today's log",
      helperText: "Everything is saved. Reopen the log if you need to adjust anything.",
      panelLabel: "Review today's workout log",
    };
  }

  if (dayStatus === "MISSED") {
    return {
      buttonLabel: "Reopen and log today",
      helperText: "Open the log to add what happened or keep the day marked as missed.",
      panelLabel: "Reopen today's workout log",
    };
  }

  return {
    buttonLabel: "Log today's workout",
    helperText: "Open the log here or jump into the calendar day card for full details.",
    panelLabel: "Today's workout log",
  };
}

export function buildCalendarDayDetailsHref(dateISO: string, planId?: string | null) {
  const params = new URLSearchParams();
  if (planId) params.set("plan", planId);
  params.set("date", dateISO);
  return `/calendar?${params.toString()}#day-details-card`;
}

export function getStravaPanelActions(connected: boolean) {
  return connected ? ["sync", "disconnect"] : ["connect"];
}
