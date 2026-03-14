import "../../dashboard/dashboard.css";
import "../plans.css";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LOADING_WEEKS = Array.from({ length: 3 }, (_, index) => index + 1);

export default function PlanDetailLoading() {
  return (
    <main className="pcal plan-detail-loading-page" aria-busy="true">
      <div className="pcal-layout pcal-loading-layout">
        <aside className="dash-side pcal-loading-side" aria-hidden="true">
          <div className="pcal-loading-side-section">
            <span className="dash-loading-skeleton" style={{ height: 18, width: "42%" }} />
            <span className="dash-loading-skeleton" style={{ height: 12, width: "70%" }} />
          </div>
          <div className="pcal-loading-side-section">
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={`plan-nav-${index}`}
                className="dash-loading-skeleton"
                style={{ height: 40, width: index === 2 ? "100%" : "84%", borderRadius: 12 }}
              />
            ))}
          </div>
        </aside>

        <section className="pcal-main pcal-loading-main">
          <div className="pcal-header pcal-loading-header" role="status" aria-live="polite">
            <div className="pcal-loading-header-top">
              <div className="dash-loading-status">
                <span className="dash-loading-kicker">Plan detail</span>
                <h1>Opening plan details</h1>
                <p className="dash-loading-copy">
                  Pulling in weeks, workout progress, and your day-by-day training view.
                </p>
              </div>
              <div className="pcal-loading-header-actions" aria-hidden="true">
                <span className="dash-loading-skeleton" style={{ height: 38, width: 120, borderRadius: 999 }} />
                <span className="dash-loading-skeleton" style={{ height: 38, width: 104, borderRadius: 999 }} />
              </div>
            </div>

            <div className="pcal-loading-meta" aria-hidden="true">
              <span className="dash-loading-skeleton" style={{ height: 24, width: 78, borderRadius: 999 }} />
              <span className="dash-loading-skeleton" style={{ height: 24, width: 92, borderRadius: 999 }} />
              <span className="dash-loading-skeleton" style={{ height: 24, width: 136, borderRadius: 999 }} />
              <span className="dash-loading-skeleton" style={{ height: 24, width: 148, borderRadius: 999 }} />
            </div>

            <div className="pcal-loading-stats" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={`plan-stat-${index}`} className="pcal-loading-stat">
                  <span className="dash-loading-skeleton" style={{ height: 22, width: index === 1 ? "54%" : "38%" }} />
                  <span className="dash-loading-skeleton" style={{ height: 12, width: "48%" }} />
                </div>
              ))}
            </div>
            <span className="dash-loading-skeleton pcal-loading-progress" aria-hidden="true" />
          </div>

          <div className="pcal-loading-inline-panels" aria-hidden="true">
            <div className="dash-card pcal-loading-panel">
              <span className="dash-loading-skeleton" style={{ height: 14, width: "28%" }} />
              <span className="dash-loading-skeleton" style={{ height: 12, width: "92%" }} />
              <span className="dash-loading-skeleton" style={{ height: 12, width: "76%" }} />
            </div>
            <div className="dash-card pcal-loading-panel">
              <span className="dash-loading-skeleton" style={{ height: 14, width: "34%" }} />
              <span className="dash-loading-skeleton" style={{ height: 12, width: "88%" }} />
              <span className="dash-loading-skeleton" style={{ height: 12, width: "70%" }} />
            </div>
          </div>

          <div className="pcal-calendar-header pcal-loading-calendar-header" aria-hidden="true">
            <div className="pcal-loading-toggle-row">
              <div className="pcal-loading-toggle-group">
                <span className="dash-loading-skeleton" style={{ height: 34, width: 70, borderRadius: 999 }} />
                <span className="dash-loading-skeleton" style={{ height: 34, width: 70, borderRadius: 999 }} />
              </div>
              <div className="pcal-loading-toggle-group">
                <span className="dash-loading-skeleton" style={{ height: 34, width: 82, borderRadius: 999 }} />
                <span className="dash-loading-skeleton" style={{ height: 34, width: 76, borderRadius: 999 }} />
              </div>
            </div>
            <div className="pcal-week pcal-week-col-header">
              <div className="pcal-week-label" />
              <div className="pcal-week-grid">
                {DAY_LABELS.map((label) => (
                  <span key={label} className="pcal-col-header-label">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="pcal-weeks pcal-loading-weeks" aria-hidden="true">
            {LOADING_WEEKS.map((weekNumber) => (
              <div key={`loading-week-${weekNumber}`} className="pcal-week">
                <div className="pcal-week-label pcal-loading-week-label">
                  <div className="pcal-loading-week-note">
                    <span className="dash-loading-skeleton" style={{ height: 14, width: "32%" }} />
                    <span className="dash-loading-skeleton" style={{ height: 11, width: "74%" }} />
                    <span className="dash-loading-skeleton" style={{ height: 11, width: "56%" }} />
                  </div>
                </div>
                <div className="pcal-week-grid">
                  {DAY_LABELS.map((label, index) => (
                    <div key={`${weekNumber}-${label}`} className="pcal-cell pcal-loading-cell">
                      <div className="pcal-loading-cell-top">
                        <span className="dash-loading-skeleton" style={{ height: 10, width: "24%" }} />
                        {index === 2 ? (
                          <span className="dash-loading-skeleton" style={{ height: 18, width: 44, borderRadius: 999 }} />
                        ) : null}
                      </div>
                      <div className="pcal-loading-cell-body">
                        <span className="dash-loading-skeleton" style={{ height: 12, width: "86%", borderRadius: 6 }} />
                        <span className="dash-loading-skeleton" style={{ height: 12, width: "64%", borderRadius: 6 }} />
                        {index % 2 === 0 ? (
                          <span className="dash-loading-skeleton" style={{ height: 16, width: "42%", borderRadius: 999 }} />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
