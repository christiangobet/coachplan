'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getDayDateFromWeekStart, resolveWeekBounds } from '@/lib/plan-dates';
import '../plans.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function formatWeekRange(startDate: Date | null, endDate: Date | null): string | null {
  if (!startDate) return null;
  const s = new Date(startDate);
  s.setHours(0, 0, 0, 0);

  let e = endDate ? new Date(endDate) : null;
  if (!e) {
    e = new Date(s);
    e.setDate(e.getDate() + 6);
  }
  e.setHours(0, 0, 0, 0);

  const sameYear = s.getFullYear() === e.getFullYear();
  const fmtStart = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  const fmtEnd = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return `${fmtStart(s)} - ${fmtEnd(e)}`;
}

function typeColor(type: string): string {
  switch (type) {
    case 'RUN': return 'var(--accent)';
    case 'STRENGTH': return '#6c5ce7';
    case 'CROSS_TRAIN': return '#0984e3';
    case 'REST': return 'var(--green)';
    case 'MOBILITY': return '#e67e22';
    case 'YOGA': return 'var(--green)';
    case 'HIKE': return '#0984e3';
    default: return 'var(--muted)';
  }
}

export default function PlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [actualDistance, setActualDistance] = useState('');
  const [actualDuration, setActualDuration] = useState('');
  const [actualPace, setActualPace] = useState('');
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [savingActuals, setSavingActuals] = useState(false);

  useEffect(() => {
    if (!planId) return;
    (async () => {
      try {
        const res = await fetch(`/api/plans/${planId}`);
        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          setError('Server returned non-JSON response.');
          return;
        }
        if (!res.ok) {
          setError(data?.error || 'Failed to load plan.');
          return;
        }
        setPlan(data.plan);
      } catch (err: any) {
        setError(err?.message || 'Failed to load plan.');
      }
    })();
  }, [planId]);

  const applyActivityUpdate = useCallback((activityId: string, updater: (activity: any) => any) => {
    setPlan((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w: any) => ({
          ...w,
          days: (w.days || []).map((d: any) => ({
            ...d,
            activities: (d.activities || []).map((a: any) =>
              a.id === activityId ? updater(a) : a
            )
          }))
        }))
      };
    });

    setSelectedActivity((prev: any) =>
      prev?.id === activityId ? updater(prev) : prev
    );
  }, []);

  // Toggle activity completion with optimistic update
  const toggleComplete = useCallback(async (activityId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling.has(activityId)) return;

    setToggling((prev) => new Set(prev).add(activityId));

    applyActivityUpdate(activityId, (activity) => ({ ...activity, completed: !activity.completed }));

    try {
      const res = await fetch(`/api/activities/${activityId}/toggle`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to toggle completion');
      const data = await res.json().catch(() => ({}));
      if (data?.activity) {
        applyActivityUpdate(activityId, () => data.activity);
      }
    } catch {
      // Revert on error
      applyActivityUpdate(activityId, (activity) => ({ ...activity, completed: !activity.completed }));
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
    }
  }, [toggling, applyActivityUpdate]);

  const saveActuals = useCallback(async () => {
    if (!selectedActivity || savingActuals) return;
    setSavingActuals(true);
    setActualsError(null);

    try {
      const res = await fetch(`/api/activities/${selectedActivity.id}/actuals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualDistance: actualDistance.trim(),
          actualDuration: actualDuration.trim(),
          actualPace: actualPace.trim()
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActualsError(data?.error || 'Failed to save actuals');
        return;
      }

      if (data?.activity) {
        applyActivityUpdate(selectedActivity.id, () => data.activity);
      }
    } catch {
      setActualsError('Failed to save actuals');
    } finally {
      setSavingActuals(false);
    }
  }, [selectedActivity, savingActuals, actualDistance, actualDuration, actualPace, applyActivityUpdate]);

  // Close modal on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedActivity(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (!selectedActivity) return;
    setActualDistance(
      selectedActivity.actualDistance === null || selectedActivity.actualDistance === undefined
        ? ''
        : String(selectedActivity.actualDistance)
    );
    setActualDuration(
      selectedActivity.actualDuration === null || selectedActivity.actualDuration === undefined
        ? ''
        : String(selectedActivity.actualDuration)
    );
    setActualPace(selectedActivity.actualPace || '');
    setActualsError(null);
  }, [selectedActivity]);

  if (error) {
    return (
      <main className="pcal">
        <p style={{ color: 'var(--red)', fontSize: 14 }}>{error}</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="pcal">
        <p className="muted">Loading...</p>
      </main>
    );
  }

  const statusClass = plan.status === 'ACTIVE' ? 'active' : plan.status === 'DRAFT' ? 'draft' : 'archived';
  const weeks = [...(plan.weeks || [])].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
  const allWeekIndexes = weeks.map((week: any) => week.weekIndex);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute plan-level stats
  const allActivities = weeks.flatMap((w: any) =>
    (w.days || []).flatMap((d: any) => d.activities || [])
  );
  const totalActivities = allActivities.length;
  const completedActivities = allActivities.filter((a: any) => a.completed).length;
  const totalMinutes = allActivities.reduce((acc: number, a: any) => acc + (a.duration || 0), 0);
  const completionPct = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

  return (
    <main className="pcal">
      {/* Header */}
      <div className="pcal-header">
        <div>
          <h1>{plan.name}</h1>
          <div className="pcal-header-meta">
            <span className={`plan-detail-status ${statusClass}`}>{plan.status}</span>
            {plan.weekCount && (
              <>
                <span className="plan-detail-meta-dot" />
                <span>{plan.weekCount} weeks</span>
              </>
            )}
            {plan.raceName && (
              <>
                <span className="plan-detail-meta-dot" />
                <span>Race: {plan.raceName}</span>
              </>
            )}
            {plan.raceDate && (
              <>
                <span className="plan-detail-meta-dot" />
                <span>Date: {new Date(plan.raceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </>
            )}
          </div>
          {plan.sourcePlanName && (
            <div className="pcal-plan-source">Plan source: {plan.sourcePlanName}</div>
          )}
        </div>
        <a className="cta secondary" href="/dashboard">&larr; Dashboard</a>
      </div>

      {/* Stats bar */}
      <div className="pcal-stats">
        <div className="pcal-stat">
          <span className="pcal-stat-value">{completionPct}%</span>
          <span className="pcal-stat-label">Complete</span>
        </div>
        <div className="pcal-stat">
          <span className="pcal-stat-value">{completedActivities}/{totalActivities}</span>
          <span className="pcal-stat-label">Workouts</span>
        </div>
        <div className="pcal-stat">
          <span className="pcal-stat-value">{Math.floor(totalMinutes / 60)}h{totalMinutes % 60 > 0 ? ` ${totalMinutes % 60}m` : ''}</span>
          <span className="pcal-stat-label">Total Time</span>
        </div>
        <div className="pcal-stat">
          <div className="pcal-stat-bar">
            <div className="pcal-stat-bar-fill" style={{ width: `${completionPct}%` }} />
          </div>
        </div>
      </div>

      {/* Calendar column headers */}
      <div className="pcal-col-headers">
        {DAY_LABELS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {/* Week rows */}
      <div className="pcal-weeks">
        {weeks.map((week: any) => {
          const dayMap = new Map<number, any>();
          for (const day of (week.days || [])) {
            dayMap.set(day.dayOfWeek, day);
          }
          const bounds = resolveWeekBounds({
            weekIndex: week.weekIndex,
            weekStartDate: week.startDate,
            weekEndDate: week.endDate,
            raceDate: plan.raceDate,
            weekCount: plan.weekCount,
            allWeekIndexes
          });
          const weekRange = formatWeekRange(bounds.startDate, bounds.endDate);
          const weekStart = bounds.startDate;
          const weekEnd = bounds.endDate;
          const isCurrentWeek = !!(weekStart && weekEnd && today >= weekStart && today <= weekEnd);

          return (
            <div className={`pcal-week${isCurrentWeek ? ' pcal-week-current' : ''}`} key={week.id}>
              <div className="pcal-week-label">
                <div className="pcal-week-head">
                  <span className="pcal-week-num">W{week.weekIndex}</span>
                  {isCurrentWeek && <span className="pcal-week-today-badge">Today</span>}
                </div>
                {weekRange && <span className="pcal-week-range">{weekRange}</span>}
                {!weekRange && <span className="pcal-week-range muted">Dates not set</span>}
              </div>
              <div className="pcal-week-grid">
                {[1, 2, 3, 4, 5, 6, 7].map((dow) => {
                  const day = dayMap.get(dow);
                  const activities = day?.activities || [];
                  const dayDate = getDayDateFromWeekStart(bounds.startDate, dow);
                  const isToday = dayDate && dayDate.getTime() === today.getTime();
                  const isPast = dayDate && dayDate.getTime() < today.getTime();
                  const showMonthInDate = !!dayDate && (dow === 1 || dayDate.getDate() === 1);

                  return (
                    <div
                      className={`pcal-cell${isToday ? ' pcal-cell-today' : ''}${isPast ? ' pcal-cell-past' : ''}`}
                      key={dow}
                    >
                      {dayDate && (
                        <span className="pcal-cell-date">
                          {showMonthInDate
                            ? dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : dayDate.getDate()}
                        </span>
                      )}
                      {isToday && <span className="pcal-cell-today-badge">Today</span>}
                      {activities.length === 0 && (
                        <span className="pcal-cell-empty" />
                      )}
                      {activities.map((a: any) => {
                        const details: string[] = [];
                        if (a.distance) details.push(`${a.distance}${a.distanceUnit === 'KM' ? 'km' : 'mi'}`);
                        if (a.duration) details.push(`${a.duration}m`);
                        if (a.paceTarget) details.push(a.paceTarget);
                        if (a.effortTarget) details.push(a.effortTarget);
                        if (a.completed) {
                          const actuals: string[] = [];
                          if (a.actualDistance) actuals.push(`${a.actualDistance}${a.distanceUnit === 'KM' ? 'km' : 'mi'}`);
                          if (a.actualDuration) actuals.push(`${a.actualDuration}m`);
                          if (a.actualPace) actuals.push(a.actualPace);
                          if (actuals.length > 0) details.push(`Actual ${actuals.join(' · ')}`);
                        }

                        return (
                          <div
                            className={`pcal-activity pcal-activity-clickable${a.completed ? ' pcal-activity-done' : ''}${a.mustDo || a.priority === 'KEY' ? ' pcal-activity-key' : ''}`}
                            key={a.id}
                            onClick={() => setSelectedActivity(a)}
                          >
                            <button
                              className={`pcal-toggle${a.completed ? ' pcal-toggle-done' : ''}`}
                              onClick={(e) => toggleComplete(a.id, e)}
                              aria-label={a.completed ? 'Mark incomplete' : 'Mark complete'}
                              type="button"
                            />
                            <div className="pcal-activity-content">
                              <span className="pcal-activity-title">{a.title}</span>
                              {details.length > 0 && (
                                <span className="pcal-activity-details">
                                  {details.join(' · ')}
                                </span>
                              )}
                              {a.subtype && (
                                <span className="pcal-activity-subtype">{a.subtype}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity detail modal */}
      {selectedActivity && (
        <div className="pcal-modal-overlay" onClick={() => setSelectedActivity(null)}>
          <div className="pcal-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="pcal-modal-close"
              onClick={() => setSelectedActivity(null)}
              type="button"
              aria-label="Close"
            >
              &times;
            </button>

            <div className="pcal-modal-type-bar" style={{ background: typeColor(selectedActivity.type) }} />

            <div className="pcal-modal-body">
              <span className="pcal-modal-type">{formatType(selectedActivity.type)}</span>
              <h2 className="pcal-modal-title">{selectedActivity.title}</h2>

              {/* Stats row */}
              <div className="pcal-modal-stats">
                {selectedActivity.distance && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.distance}
                    </span>
                    <span className="pcal-modal-stat-label">
                      {selectedActivity.distanceUnit === 'KM' ? 'km' : 'mi'}
                    </span>
                  </div>
                )}
                {selectedActivity.duration && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.duration}
                    </span>
                    <span className="pcal-modal-stat-label">min</span>
                  </div>
                )}
                {selectedActivity.paceTarget && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.paceTarget}
                    </span>
                    <span className="pcal-modal-stat-label">pace</span>
                  </div>
                )}
                {selectedActivity.effortTarget && (
                  <div className="pcal-modal-stat">
                    <span className="pcal-modal-stat-value">
                      {selectedActivity.effortTarget}
                    </span>
                    <span className="pcal-modal-stat-label">effort</span>
                  </div>
                )}
              </div>

              {/* Instructions / raw text */}
              {selectedActivity.rawText && (
                <div className="pcal-modal-section">
                  <h3 className="pcal-modal-section-title">Instructions</h3>
                  <p className="pcal-modal-text">{selectedActivity.rawText}</p>
                </div>
              )}

              {/* Notes */}
              {selectedActivity.notes && (
                <div className="pcal-modal-section">
                  <h3 className="pcal-modal-section-title">Notes</h3>
                  <p className="pcal-modal-text">{selectedActivity.notes}</p>
                </div>
              )}

              {/* Actuals */}
              <div className="pcal-modal-section">
                <h3 className="pcal-modal-section-title">Actuals</h3>
                {selectedActivity.completed ? (
                  <div className="pcal-modal-actuals-form">
                    <label>
                      Distance ({selectedActivity.distanceUnit === 'KM' ? 'km' : 'mi'})
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={actualDistance}
                        onChange={(e) => setActualDistance(e.target.value)}
                        placeholder={selectedActivity.distance != null ? String(selectedActivity.distance) : 'e.g. 8'}
                      />
                    </label>
                    <label>
                      Duration (min)
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={actualDuration}
                        onChange={(e) => setActualDuration(e.target.value)}
                        placeholder={selectedActivity.duration != null ? String(selectedActivity.duration) : 'e.g. 50'}
                      />
                    </label>
                    <label>
                      Pace
                      <input
                        type="text"
                        value={actualPace}
                        onChange={(e) => setActualPace(e.target.value)}
                        placeholder={selectedActivity.paceTarget || 'e.g. 7:20 /mi'}
                      />
                    </label>
                    {actualsError && <p className="pcal-modal-form-error">{actualsError}</p>}
                    <button
                      className="pcal-modal-actuals-save"
                      onClick={saveActuals}
                      type="button"
                      disabled={savingActuals}
                    >
                      {savingActuals ? 'Saving…' : 'Save Actuals'}
                    </button>
                  </div>
                ) : (
                  <p className="pcal-modal-text pcal-modal-actuals-hint">
                    Mark this activity complete to log actual distance, duration, and pace.
                  </p>
                )}
              </div>

              {/* Tags */}
              {selectedActivity.tags && Array.isArray(selectedActivity.tags) && selectedActivity.tags.length > 0 && (
                <div className="pcal-modal-tags">
                  {selectedActivity.tags.map((tag: string, i: number) => (
                    <span className="pcal-modal-tag" key={i}>{tag}</span>
                  ))}
                </div>
              )}

              {/* Priority / Key workout badge */}
              {(selectedActivity.mustDo || selectedActivity.priority === 'KEY') && (
                <div className="pcal-modal-badge-row">
                  <span className="pcal-modal-badge">Key Workout</span>
                </div>
              )}

              {/* Complete toggle */}
              <button
                className={`pcal-modal-complete${selectedActivity.completed ? ' pcal-modal-complete-done' : ''}`}
                onClick={(e) => toggleComplete(selectedActivity.id, e)}
                type="button"
              >
                {selectedActivity.completed ? 'Completed — Undo' : 'Mark as Complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
