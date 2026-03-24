// src/components/WeekStrip.tsx
// NOTE: No CSS import — styles live in src/app/calendar/calendar.css (imported by page.tsx)
import Link from "next/link";

export type WeekStripDay = {
  dateISO: string;
  dayLetter: string;
  dateNum: number;
  activityCode: string;
  activityTypes: string[];   // all type codes for the day, e.g. ["RUN","STR"]
  distanceLabel: string | null;
  durationLabel: string | null;
  status: "DONE" | "MISSED" | "PARTIAL" | "OPEN" | null;
  hasStrava: boolean;
  isToday: boolean;
  isSelected: boolean;
  inPlan: boolean;
  href: string;
};

type WeekStripProps = {
  days: WeekStripDay[];
  weekLabel: string;
  prevWeekHref: string;
  nextWeekHref: string;
};

export default function WeekStrip({ days, weekLabel, prevWeekHref, nextWeekHref }: WeekStripProps) {
  return (
    <div className="week-strip">
      <div className="week-strip-cells">
        {days.map((day) => {
          const cellClass = [
            "week-strip-cell",
            day.isToday ? "wsc-today" : "",
            day.isSelected ? "wsc-selected" : "",
            day.inPlan ? "wsc-in-plan" : "",
            day.status === "DONE" ? "wsc-done" : "",
            day.status === "MISSED" ? "wsc-missed" : "",
            day.status === "PARTIAL" ? "wsc-partial" : "",
          ].filter(Boolean).join(" ");
          return (
            <Link key={day.dateISO} className={cellClass} href={day.href} aria-label={`Go to ${new Date(day.dateISO + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`}>
              <span className="wsc-letter">{day.dayLetter}</span>
              <span className="wsc-date">{day.dateNum}</span>
              {day.inPlan && day.activityTypes.length > 0 ? (
                <span className="wsc-types">
                  {day.activityTypes.map((t) => (
                    <span key={t} className={`wsc-type-badge wsc-type-${t.toLowerCase()}`}>{t}</span>
                  ))}
                </span>
              ) : (
                <span className="wsc-code">{day.inPlan ? day.activityCode : ""}</span>
              )}
              {day.inPlan && (day.distanceLabel || day.durationLabel) && (
                <span className="wsc-metric">{day.distanceLabel ?? day.durationLabel}</span>
              )}
              <span className="wsc-footer">
                <span className="wsc-status-dot" aria-hidden="true" />
                {day.hasStrava && <span className="wsc-strava-dot" aria-label="Strava logged" />}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
