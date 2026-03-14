import "../dashboard/dashboard.css";
import "./calendar.css";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CALENDAR_CELLS = Array.from({ length: 35 }, (_, index) => index);

export default function CalendarLoading() {
  return (
    <main className="dash cal-page cal-loading-page" aria-busy="true">
      <div className="dash-grid">
        <aside className="dash-side cal-loading-side" aria-hidden="true">
          <div className="cal-loading-side-section">
            <span className="dash-loading-skeleton" style={{ height: 18, width: "46%" }} />
            <span className="dash-loading-skeleton" style={{ height: 12, width: "72%" }} />
          </div>
          <div className="cal-loading-side-section">
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={`calendar-nav-${index}`}
                className="dash-loading-skeleton"
                style={{ height: 40, width: index === 1 ? "100%" : "86%", borderRadius: 12 }}
              />
            ))}
          </div>
        </aside>

        <section className="dash-center">
          <div className="dash-card cal-loading-header-card" role="status" aria-live="polite">
            <div className="cal-loading-status-row">
              <div className="dash-loading-status">
                <span className="dash-loading-kicker">Athlete calendar</span>
                <h1>Loading your calendar</h1>
                <p className="dash-loading-copy">
                  Preparing this month, your active plan, and today&apos;s workout status.
                </p>
              </div>
              <div className="cal-loading-view-pills" aria-hidden="true">
                <span className="dash-loading-skeleton" style={{ height: 38, width: 82, borderRadius: 999 }} />
                <span className="dash-loading-skeleton" style={{ height: 38, width: 130, borderRadius: 999 }} />
                <span className="dash-loading-skeleton" style={{ height: 38, width: 116, borderRadius: 999 }} />
              </div>
            </div>
          </div>

          <div className="dash-card cal-loading-summary-card" aria-hidden="true">
            <div className="cal-loading-summary-grid">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={`calendar-stat-${index}`} className="cal-loading-summary-stat">
                  <span className="dash-loading-skeleton" style={{ height: 11, width: "34%" }} />
                  <span className="dash-loading-skeleton" style={{ height: 22, width: index === 1 ? "74%" : "52%" }} />
                  <span className="dash-loading-skeleton" style={{ height: 12, width: "68%" }} />
                </div>
              ))}
            </div>
          </div>

          <div className="dash-card cal-loading-month-card" aria-hidden="true">
            <div className="cal-loading-month-nav">
              <span className="dash-loading-skeleton" style={{ height: 44, width: 98, borderRadius: 10 }} />
              <span className="dash-loading-skeleton" style={{ height: 18, width: 168 }} />
              <span className="dash-loading-skeleton" style={{ height: 44, width: 98, borderRadius: 10 }} />
            </div>

            <div className="cal-loading-weekdays">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="cal-loading-weekday">
                  {label}
                </span>
              ))}
            </div>

            <div className="cal-loading-grid">
              {CALENDAR_CELLS.map((cell) => (
                <div key={`calendar-cell-${cell}`} className="cal-loading-cell">
                  <span className="dash-loading-skeleton" style={{ height: 10, width: cell % 7 === 0 ? "42%" : "28%" }} />
                  <span className="dash-loading-skeleton" style={{ height: 12, width: "88%", borderRadius: 6 }} />
                  <span className="dash-loading-skeleton" style={{ height: 12, width: "62%", borderRadius: 6 }} />
                  {cell % 3 === 0 ? (
                    <span className="dash-loading-skeleton" style={{ height: 18, width: "38%", borderRadius: 999, marginTop: "auto" }} />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
