// src/app/design/dashboard/page.tsx
// ⚠️ Design sandbox — no auth, no DB, no server components
import './../../dashboard/dashboard.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MOCK = {
  name: 'Christian',
  initials: 'CG',
  planName: 'Blue Ridge 50K',
  raceName: 'Blue Ridge 50K Ultra',
  raceDate: 'Jun 14, 2025',
  currentWeekIndex: 4,
  totalWeeks: 15,
  totalPlanCount: 2,
  totalActivities: 161,
  completedActivities: 38,
  completionPct: 24,
  weekCompletionPct: 60,
  keyCompletionPct: 50,
  totalMinutes: 210,
  today: {
    label: 'Friday, February 21',
    activity: {
      type: 'RUN',
      title: 'Easy Run',
      abbr: 'RUN',
      meta: 'Fri, Feb 21 · 8.0 km · Pace 5:30 /km',
      detail: 'Easy effort. Keep heart rate in Z2. Run on trails if possible.',
    },
    status: 'Ready to log',
  },
  upcoming: [
    { id: 'u1', day: 'Sat', date: 'Sat, Feb 22', title: 'Long Run',  type: 'run',      abbr: 'RUN', metrics: '19 km · Pace 5:45 /km' },
    { id: 'u2', day: 'Sun', date: 'Sun, Feb 23', title: 'Mobility',  type: 'mobility', abbr: 'MOB', metrics: '30 min' },
    { id: 'u3', day: 'Mon', date: 'Mon, Feb 24', title: 'Strength',  type: 'strength', abbr: 'STR', metrics: '45 min' },
  ],
  statusFeed: [
    { alert: false, text: "You're on track" },
    { alert: false, text: 'Mon, Feb 17 · Done' },
    { alert: false, text: 'Tue, Feb 18 · Done' },
    { alert: true,  text: 'Wed, Feb 19 · Pending' },
    { alert: false, text: 'Thu, Feb 20 · Done' },
  ],
  weekDots: [
    { label: 'M', state: 'done' },
    { label: 'T', state: 'done' },
    { label: 'W', state: 'missed' },
    { label: 'T', state: 'done' },
    { label: 'F', state: 'today' },
    { label: 'S', state: '' },
    { label: 'S', state: '' },
  ],
};

function DotContent({ state }: { state: string }) {
  if (state === 'done')   return <span className="dash-week-dot done">✓</span>;
  if (state === 'missed') return <span className="dash-week-dot missed">✕</span>;
  if (state === 'today')  return <span className="dash-week-dot today">•</span>;
  return <span className="dash-week-dot" />;
}

function MockSidebar() {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {['Today', 'Plans', 'Training Calendar', 'Progress', 'Upload', 'Profile'].map((item) => (
        <a
          key={item}
          href="#"
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius)',
            fontSize: 14,
            fontWeight: item === 'Today' ? 700 : 500,
            color: item === 'Today' ? 'var(--accent)' : 'var(--muted)',
            background: item === 'Today' ? 'rgba(252,76,2,0.08)' : 'transparent',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {item}
        </a>
      ))}
    </nav>
  );
}

function MockLogCard() {
  return (
    <div className="dash-card" id="dash-activity-log-card" style={{ marginTop: 16 }}>
      <div className="dash-card-header">
        <span className="dash-card-title">Today · Friday, February 21</span>
      </div>
      <div style={{ padding: '12px 0' }}>
        <div className="workout-row">
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Easy Run</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              8.0 km · Pace 5:30 /km · Z2
            </div>
          </div>
          <button className="cta secondary" style={{ fontSize: 12, padding: '6px 14px' }}>
            Log
          </button>
        </div>
      </div>
      <div style={{
        display: 'flex', gap: 8, paddingTop: 8,
        borderTop: '1px solid var(--border)', marginTop: 4
      }}>
        <button className="btn-light" style={{ fontSize: 12 }}>Mark Done</button>
        <button className="btn-ghost" style={{ fontSize: 12 }}>Mark Missed</button>
      </div>
    </div>
  );
}

export default function DesignDashboard() {
  const {
    name, initials, planName, raceName, raceDate,
    currentWeekIndex, totalWeeks, totalPlanCount,
    totalActivities, completedActivities, completionPct,
    weekCompletionPct, keyCompletionPct, totalMinutes,
    today, upcoming, statusFeed, weekDots,
  } = MOCK;

  const upcomingHero = upcoming[0];
  const upcomingRest = upcoming.slice(1);
  const hoursLogged = Math.floor(totalMinutes / 60);
  const minsLogged = totalMinutes % 60;
  const weeklyTimePct = Math.min(100, Math.round((totalMinutes / 420) * 100));

  return (
    <main className="dash">
      <div className="dash-atmosphere" />
      <div className="dash-topo" />

      <div className="dash-grid">

        {/* ── Left sidebar ── */}
        <div className="dash-left-col">
          <MockSidebar />
        </div>

        {/* ── Center feed ── */}
        <section className="dash-center">
          <div className="dash-page-heading">
            <h1>Today</h1>
            <p>Good morning, {name} · Friday, February 21</p>
          </div>

          {/* Plan summary bar */}
          <div className="dash-card dash-plan-summary">
            <div className="dash-greeting-meta">
              <div className="dash-greeting-meta-item">
                <span className="dash-greeting-meta-label">Plan</span>
                <span className="dash-greeting-meta-value">{planName}</span>
              </div>
              <div className="dash-greeting-meta-item">
                <span className="dash-greeting-meta-label">Race Name</span>
                <span className="dash-greeting-meta-value">{raceName}</span>
              </div>
              <div className="dash-greeting-meta-item">
                <span className="dash-greeting-meta-label">Race Date</span>
                <span className="dash-greeting-meta-value">{raceDate}</span>
              </div>
            </div>
            <a className="dash-greeting-edit-link" href="#">View Plan</a>
          </div>

          {/* Today hero */}
          <div className="dash-hero">
            <div className="dash-hero-top">
              <span className="dash-hero-chip">Up Next</span>
              <span className="dash-hero-top-status">{today.status}</span>
            </div>
            <div className="dash-hero-label">TODAY · {today.label}</div>
            <span className={`dash-type-badge dash-type-${today.activity.type}`}>
              <span>{today.activity.abbr}</span>
            </span>
            <h2 className="dash-hero-title">{today.activity.title}</h2>
            <div className="dash-hero-meta">
              <span>{today.activity.meta}</span>
            </div>
            <div className="dash-hero-detail">{today.activity.detail}</div>
            <div className="dash-hero-actions">
              <a className="dash-btn-primary" href="#dash-activity-log-card">Log Day</a>
              <a className="dash-btn-secondary" href="#">View Plan</a>
            </div>
            <div className="dash-adjust-actions">
              <span className="dash-adjust-label">Need to adapt?</span>
              <a className="dash-adjust-link" href="#">I missed this</a>
              <a className="dash-adjust-link" href="#">Low energy</a>
              <a className="dash-adjust-link" href="#">Traveling</a>
              <a className="dash-adjust-link" href="#">Swap workout</a>
            </div>
          </div>

          {/* Activity log card stub */}
          <MockLogCard />

          {/* Next up */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Next Up</span>
              <a className="dash-card-link" href="#">View plan</a>
            </div>
            <div className={`dash-next-hero type-${upcomingHero.type}`}>
              <div className="dash-next-hero-top">
                <span className="dash-next-hero-label">Tomorrow</span>
                <span className="dash-next-hero-date">{upcomingHero.metrics}</span>
              </div>
              <div className="dash-next-hero-title">{upcomingHero.title}</div>
              <div className="dash-next-hero-meta">
                <span className={`dash-type-pill type-${upcomingHero.type}`}>
                  {upcomingHero.abbr}
                </span>
              </div>
            </div>
            {upcomingRest.map((a) => (
              <div className="dash-upcoming-item" key={a.id}>
                <div className="dash-upcoming-left">
                  <div className="dash-upcoming-day">{a.day}</div>
                  <div className="dash-upcoming-info">
                    <span className="dash-upcoming-title">{a.title}</span>
                    <span className="dash-upcoming-type">{a.abbr}</span>
                    <span className="dash-upcoming-date">{a.date}</span>
                  </div>
                </div>
                <span className="dash-upcoming-metrics">{a.metrics}</span>
              </div>
            ))}
          </div>

          {/* Guide */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Guide</span>
            </div>
            <a className="dash-guide-item" href="#">
              <span>Training Guidelines</span>
              <span className="dash-guide-arrow">→</span>
            </a>
            <a className="dash-guide-item" href="#">
              <span>Nutrition &amp; Hydration</span>
              <span className="dash-guide-arrow">→</span>
            </a>
          </div>
        </section>

        {/* ── Right sidebar ── */}
        <aside className="dash-right">

          {/* Profile card */}
          <div className="dash-card dash-profile-card">
            <div className="dash-profile-top">
              <div className="dash-profile-avatar">{initials}</div>
              <div>
                <h3>{name}</h3>
                <p>Runner · CoachPlan</p>
              </div>
            </div>
            <div className="dash-profile-stats">
              <div><strong>{totalPlanCount}</strong><span>Plans</span></div>
              <div><strong>{totalActivities}</strong><span>Workouts</span></div>
              <div><strong>{completedActivities}</strong><span>Done</span></div>
            </div>
          </div>

          {/* Status feed */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Training Calendar Status</span>
            </div>
            <div className="dash-status-feed">
              {statusFeed.map((s, i) => (
                <div className="dash-status-item" key={i}>
                  <span className={`dash-status-dot ${s.alert ? 'warn' : 'ok'}`} />
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Week snapshot */}
          <div className="dash-card dash-week-snapshot">
            <div className="dash-card-header">
              <span className="dash-card-title">This Week</span>
              <span className="dash-week-snapshot-range">Week {currentWeekIndex}</span>
            </div>
            <div className="dash-week-snapshot-row">
              <span>Workouts</span><strong>{weekCompletionPct}%</strong>
            </div>
            <div className="dash-week-snapshot-bar">
              <div style={{ width: `${weekCompletionPct}%` }} />
            </div>
            <div className="dash-week-snapshot-row">
              <span>Key sessions</span><strong>{keyCompletionPct}%</strong>
            </div>
            <div className="dash-week-snapshot-bar key">
              <div style={{ width: `${keyCompletionPct}%` }} />
            </div>
            <div className="dash-week-snapshot-row">
              <span>Time logged</span><strong>{hoursLogged}h {minsLogged}m</strong>
            </div>
            <div className="dash-week-snapshot-bar time">
              <div style={{ width: `${weeklyTimePct}%` }} />
            </div>
          </div>

          {/* Week strip */}
          <div className="dash-card">
            <details className="dash-collapse" open>
              <summary className="dash-collapse-summary">
                <span className="dash-card-title">This Week</span>
                <span style={{ fontSize: 12, color: 'var(--d-muted)' }}>
                  Week {currentWeekIndex}
                </span>
              </summary>
              <div className="dash-collapse-body">
                <div className="dash-week-strip">
                  {weekDots.map((d, i) => (
                    <div className="dash-week-day" key={i}>
                      <span className="dash-week-label">{d.label}</span>
                      <DotContent state={d.state} />
                    </div>
                  ))}
                </div>
                <div className="dash-week-stats">
                  <div className="dash-week-stat">
                    <div className="dash-week-stat-value">1/2</div>
                    <div className="dash-week-stat-label">Key Workouts</div>
                  </div>
                  <div className="dash-week-stat">
                    <div className="dash-week-stat-value">{hoursLogged}h {minsLogged}m</div>
                    <div className="dash-week-stat-label">Total Time</div>
                  </div>
                </div>
              </div>
            </details>
          </div>

          {/* Plan progress */}
          <div className="dash-card">
            <details className="dash-collapse" open>
              <summary className="dash-collapse-summary">
                <span className="dash-card-title">Plan Progress</span>
                <span style={{ fontSize: 12, color: 'var(--d-muted)' }}>{completionPct}%</span>
              </summary>
              <div className="dash-collapse-body">
                <div className="dash-progress-big">
                  <div className="dash-progress-pct">
                    {completionPct}<span className="dash-progress-sign">%</span>
                  </div>
                  <div className="dash-progress-sub">
                    {completedActivities} of {totalActivities} workouts
                  </div>
                </div>
                <div className="dash-progress-bar">
                  <div className="dash-progress-fill" style={{ width: `${completionPct}%` }} />
                </div>
                <div className="dash-progress-details">
                  <span>Week <strong>{currentWeekIndex}</strong> of <strong>{totalWeeks}</strong></span>
                  <span><strong>{completedActivities}</strong> / {totalActivities}</span>
                </div>
                <a className="dash-view-plan" href="#">View Full Plan →</a>
              </div>
            </details>
          </div>

        </aside>
      </div>
    </main>
  );
}
