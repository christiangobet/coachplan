// src/app/design/plan-review/page.tsx
// ⚠️ Design sandbox — no auth, no DB, no API calls
// Mirrors the real review page UI using hardcoded mock data

import '../../../app/plans/[id]/review/review.css';

type MockActivity = {
  id: string;
  title: string;
  type: string;
  distance: number | null;
  distanceUnit: 'KM' | 'MILES' | null;
  duration: number | null;
  paceTarget: string | null;
  paceTargetBucket: string | null;
  effortTarget: string | null;
  rawText: string | null;
  notes: string | null;
};

type MockDay = {
  id: string;
  dayOfWeek: number;
  weekId: string;
  rawText: string | null;
  notes: string | null;
  activities: MockActivity[];
};

type MockWeek = {
  id: string;
  weekIndex: number;
  days: MockDay[];
};

type MockParseProfile = {
  plan_length_weeks: number;
  days_per_week: number;
  distance_type: string | null;
  intensity_model: string | null;
  units: string | null;
  language_hint: string | null;
  peak_week_km: number | null;
  peak_long_run_km: number | null;
  taper_weeks: number;
  structure_tags: string[];
  includes_quality: Record<string, boolean> | null;
};

type MockPlan = {
  name: string;
  status: string;
  weeks: MockWeek[];
  parseProfile: MockParseProfile;
};

const MOCK_PLAN: MockPlan = {
  name: 'Blue Ridge 50K',
  status: 'DRAFT',
  weeks: [
    {
      id: 'w1', weekIndex: 1,
      days: [
        {
          id: 'd1', dayOfWeek: 1, weekId: 'w1', rawText: null, notes: null,
          activities: [
            { id: 'a1', title: 'Strength', type: 'STRENGTH', distance: null, distanceUnit: null, duration: 45, paceTarget: null, paceTargetBucket: null, effortTarget: null, rawText: 'Full body strength session', notes: null },
            { id: 'a2', title: 'Easy Run', type: 'RUN', distance: 3.22, distanceUnit: 'KM', duration: null, paceTarget: '5:30 /km', paceTargetBucket: 'EASY', effortTarget: 'Z2', rawText: 'Easy effort, conversational pace', notes: null },
          ]
        },
        {
          id: 'd2', dayOfWeek: 2, weekId: 'w1', rawText: null, notes: null,
          activities: [
            { id: 'a3', title: 'Recovery Run', type: 'RUN', distance: 4.8, distanceUnit: 'KM', duration: null, paceTarget: '5:50 /km', paceTargetBucket: 'RECOVERY', effortTarget: 'Z1', rawText: null, notes: null },
          ]
        },
        {
          id: 'd3', dayOfWeek: 3, weekId: 'w1', rawText: null, notes: null,
          activities: [
            { id: 'a4', title: 'Cross Training', type: 'CROSS_TRAIN', distance: null, distanceUnit: null, duration: 45, paceTarget: null, paceTargetBucket: null, effortTarget: 'Z2', rawText: 'Cycling or swimming', notes: null },
          ]
        },
        {
          id: 'd4', dayOfWeek: 4, weekId: 'w1', rawText: null, notes: null,
          activities: [
            { id: 'a5', title: 'Tempo Run', type: 'RUN', distance: 8, distanceUnit: 'KM', duration: null, paceTarget: '4:50 /km', paceTargetBucket: 'TEMPO', effortTarget: 'Z4', rawText: '2km warm up, 4km tempo, 2km cool down', notes: null },
          ]
        },
        {
          id: 'd5', dayOfWeek: 5, weekId: 'w1', rawText: null, notes: null,
          activities: []
        },
        {
          id: 'd6', dayOfWeek: 6, weekId: 'w1', rawText: null, notes: null,
          activities: [
            { id: 'a6', title: 'Long Run', type: 'RUN', distance: 16, distanceUnit: 'KM', duration: null, paceTarget: '5:40 /km', paceTargetBucket: 'LONG', effortTarget: 'Z2', rawText: 'Easy effort long run on trails if possible', notes: null },
          ]
        },
        {
          id: 'd7', dayOfWeek: 7, weekId: 'w1', rawText: null, notes: null,
          activities: [
            { id: 'a7', title: 'Mobility', type: 'MOBILITY', distance: null, distanceUnit: null, duration: 30, paceTarget: null, paceTargetBucket: null, effortTarget: null, rawText: 'Yoga or foam rolling', notes: null },
          ]
        },
      ]
    },
    {
      id: 'w2', weekIndex: 2,
      days: [
        {
          id: 'd8', dayOfWeek: 1, weekId: 'w2', rawText: null, notes: null,
          activities: [
            { id: 'a8', title: 'Strength', type: 'STRENGTH', distance: null, distanceUnit: null, duration: 45, paceTarget: null, paceTargetBucket: null, effortTarget: null, rawText: null, notes: null },
            { id: 'a9', title: 'Easy Run', type: 'RUN', distance: 5, distanceUnit: 'KM', duration: null, paceTarget: '5:30 /km', paceTargetBucket: 'EASY', effortTarget: 'Z2', rawText: null, notes: null },
          ]
        },
        {
          id: 'd9', dayOfWeek: 3, weekId: 'w2', rawText: null, notes: null,
          activities: [
            { id: 'a10', title: 'Hill Repeats', type: 'RUN', distance: 10, distanceUnit: 'KM', duration: null, paceTarget: '4:30 /km', paceTargetBucket: 'INTERVAL', effortTarget: 'Z5', rawText: '6 x 90 sec hill repeats with recovery jog', notes: null },
          ]
        },
        {
          id: 'd10', dayOfWeek: 6, weekId: 'w2', rawText: null, notes: null,
          activities: [
            { id: 'a11', title: 'Long Run', type: 'RUN', distance: 19, distanceUnit: 'KM', duration: null, paceTarget: '5:45 /km', paceTargetBucket: 'LONG', effortTarget: 'Z2', rawText: null, notes: null },
          ]
        },
      ]
    }
  ],
  parseProfile: {
    plan_length_weeks: 15,
    days_per_week: 7,
    distance_type: 'TRAIL',
    intensity_model: 'Unknown',
    units: 'Miles',
    language_hint: 'En',
    peak_week_km: 19.3,
    peak_long_run_km: null,
    taper_weeks: 3,
    structure_tags: ['Cutback Weeks', 'One Quality Day', 'Taper Phase'],
    includes_quality: {
      intervals: false,
      tempo: true,
      hills: true,
      strides: false,
      strength: true,
      cross_training: true,
    }
  }
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function humanizeToken(value: string | null) {
  if (!value) return 'Unknown';
  return value.replace(/[_-]+/g, ' ').toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

export default function DesignPlanReview() {
  const profile = MOCK_PLAN.parseProfile;
  const totalActivities = MOCK_PLAN.weeks.flatMap(w => w.days).flatMap(d => d.activities).length;
  const runActivities = MOCK_PLAN.weeks.flatMap(w => w.days).flatMap(d => d.activities).filter(a => a.type === 'RUN').length;
  const qualityFlags = profile.includes_quality
    ? Object.entries(profile.includes_quality).filter(([, v]) => v).map(([k]) =>
        k.replace(/_/g, ' ').replace(/\b[a-z]/g, m => m.toUpperCase()))
    : [];

  return (
    <main className="review-page-shell">

      {/* ── Hero header ── */}
      <section className="review-page-card review-hero">
        <div className="review-hero-head">
          <div>
            <h1>Confirm Parse and Activate Plan</h1>
            <p>Plan: <strong>{MOCK_PLAN.name}</strong> · Status: <strong>{MOCK_PLAN.status}</strong></p>
            <p className="review-publish-copy">
              You are one step away. Confirm this parsed plan, then activate it to unlock Today and Training Calendar.
            </p>
          </div>
          <div className="review-hero-actions">
            <button className="cta" type="button">Activate Plan</button>
            <button className="cta secondary" type="button">View Plan</button>
          </div>
        </div>

        {/* Stats row */}
        <div className="review-stats-grid">
          <div><strong>{MOCK_PLAN.weeks.length}</strong><span>Weeks parsed</span></div>
          <div><strong>{totalActivities}</strong><span>Activities</span></div>
          <div><strong>{runActivities}</strong><span>Run activities</span></div>
        </div>

        {/* Plan profile */}
        <div className="review-profile-panel">
          <div className="review-profile-head">
            <h3>Detected Plan Profile</h3>
            <p>Auto-inferred document context used to guide structured parsing.</p>
          </div>
          <div className="review-profile-grid">
            <div><strong>{profile.plan_length_weeks}</strong><span>Plan length (weeks)</span></div>
            <div><strong>{profile.days_per_week}</strong><span>Days per week</span></div>
            <div><strong>{humanizeToken(profile.distance_type)}</strong><span>Distance type</span></div>
            <div><strong>{humanizeToken(profile.intensity_model)}</strong><span>Intensity model</span></div>
            <div><strong>{humanizeToken(profile.units)}</strong><span>Units</span></div>
            <div><strong>{humanizeToken(profile.language_hint)}</strong><span>Language hint</span></div>
            <div><strong>{profile.peak_week_km?.toFixed(1)} km</strong><span>Peak week</span></div>
            <div><strong>—</strong><span>Peak long run</span></div>
            <div><strong>{profile.taper_weeks}</strong><span>Taper weeks</span></div>
          </div>
          <div className="review-profile-tags">
            {qualityFlags.map(f => <span key={f} className="review-profile-tag">{f}</span>)}
            {profile.structure_tags.map(t => <span key={t} className="review-profile-tag alt">{t}</span>)}
          </div>
        </div>

        <p className="review-autosave">Changes save automatically</p>
        <p className="review-notice">Upload completed. Review and adjust activities before publishing.</p>
      </section>

      {/* ── Week grid ── */}
      <section className="review-week-grid" id="review-week-grid">
        {MOCK_PLAN.weeks.map((week) => {
          const days = [...week.days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
          const weekActivityCount = days.reduce((sum, d) => sum + d.activities.length, 0);
          return (
            <article key={week.id} className="review-page-card review-week-card">
              <div className="review-week-head">
                <h2>Week {week.weekIndex}</h2>
                <span>{weekActivityCount} activities</span>
              </div>

              {days.map((day) => (
                <div key={day.id} className="review-day-block">
                  <div className="review-day-head">
                    <span className="review-day-pill">
                      {DAY_LABELS[(day.dayOfWeek || 1) - 1]}
                    </span>
                    <div className="review-day-actions">
                      <button className="review-save-btn secondary" type="button">Show Notes</button>
                      <button className="review-save-btn" type="button">Add Activity</button>
                    </div>
                  </div>

                  <div className="review-activity-list">
                    {day.activities.length > 0 && (
                      <div className="review-activity-head-row" aria-hidden="true">
                        <span>Activity</span>
                        <span>Type</span>
                        <span>Distance</span>
                        <span>Duration</span>
                        <span>Actions</span>
                      </div>
                    )}

                    {day.activities.length === 0 && (
                      <p className="review-muted" style={{ padding: '8px 0', fontSize: 13 }}>
                        Rest day
                      </p>
                    )}

                    {day.activities.map((activity) => (
                      <div key={activity.id} className="review-activity-item review-activity-item-compact">
                        <div className="review-activity-quick-grid">

                          <label className="review-field review-col-activity review-field-inline">
                            <span className="review-visually-hidden">Activity</span>
                            <input type="text" defaultValue={activity.title} />
                          </label>

                          <label className="review-field review-col-type review-field-inline">
                            <span className="review-visually-hidden">Workout type</span>
                            <select defaultValue={activity.type}>
                              {['RUN','STRENGTH','CROSS_TRAIN','REST','MOBILITY','YOGA','HIKE','OTHER'].map(t => (
                                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                              ))}
                            </select>
                            {activity.type === 'RUN' && (
                              <div className="review-pace-categories review-pace-categories-inline" role="radiogroup">
                                {[
                                  { value: 'RECOVERY', short: 'RE' },
                                  { value: 'EASY', short: 'EZ' },
                                  { value: 'LONG', short: 'LR' },
                                  { value: 'RACE', short: 'RP' },
                                  { value: 'TEMPO', short: 'TP' },
                                  { value: 'THRESHOLD', short: 'TH' },
                                  { value: 'INTERVAL', short: 'IN' },
                                ].map(opt => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    className={`review-pace-chip${activity.paceTargetBucket === opt.value ? ' active' : ''}`}
                                  >
                                    {opt.short}
                                  </button>
                                ))}
                              </div>
                            )}
                          </label>

                          <label className="review-field review-col-distance review-field-inline">
                            <span className="review-visually-hidden">Distance</span>
                            <div className={`review-distance-input-row${activity.distance ? '' : ' single'}`}>
                              <input
                                type="number"
                                defaultValue={activity.distance ?? ''}
                                placeholder="Distance"
                                min={0} step={0.1}
                              />
                              {activity.distance && (
                                <select defaultValue={activity.distanceUnit ?? 'KM'}>
                                  <option value="KM">km</option>
                                  <option value="MILES">mi</option>
                                </select>
                              )}
                            </div>
                          </label>

                          <label className="review-field review-col-duration review-field-inline">
                            <span className="review-visually-hidden">Duration</span>
                            <input
                              type="number"
                              defaultValue={activity.duration ?? ''}
                              placeholder="Duration (min)"
                              min={0} step={1}
                            />
                          </label>

                          <div className="review-col-actions review-activity-actions-compact">
                            <button className="review-save-btn secondary review-details-toggle" type="button">
                              Details
                            </button>
                            <button className="review-delete-btn ghost" type="button">
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </section>

    </main>
  );
}
