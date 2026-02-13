'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import '../plans.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function getDayDate(weekStartDate: string | null | undefined, dayOfWeek: number): Date | null {
  if (!weekStartDate) return null;
  const start = new Date(weekStartDate);
  if (isNaN(start.getTime())) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + (dayOfWeek - 1));
  return d;
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeekRange(startDate: string | null | undefined, endDate: string | null | undefined): string | null {
  if (!startDate) return null;
  const s = new Date(startDate);
  const e = endDate ? new Date(endDate) : null;
  if (isNaN(s.getTime())) return null;
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (e && !isNaN(e.getTime())) return `${fmt(s)} – ${fmt(e)}`;
  return fmt(s);
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

  // Build a lookup: weekId -> dayOfWeek -> day data
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
            {plan.raceDate && (
              <>
                <span className="plan-detail-meta-dot" />
                <span>Race: {new Date(plan.raceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </>
            )}
          </div>
        </div>
        <a className="cta secondary" href="/plans">&larr; All Plans</a>
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
          const hasDates = !!week.startDate;
          const weekRange = formatWeekRange(week.startDate, week.endDate);

          return (
            <div className="pcal-week" key={week.id}>
              <div className="pcal-week-label">
                <span className="pcal-week-num">W{week.weekIndex}</span>
                {weekRange && <span className="pcal-week-range">{weekRange}</span>}
              </div>
              <div className="pcal-week-grid">
                {[1, 2, 3, 4, 5, 6, 7].map((dow) => {
                  const day = dayMap.get(dow);
                  const activities = day?.activities || [];
                  const dayDate = hasDates ? getDayDate(week.startDate, dow) : null;
                  const isToday = dayDate && dayDate.getTime() === today.getTime();
                  const isPast = dayDate && dayDate.getTime() < today.getTime();

                  return (
                    <div
                      className={`pcal-cell${isToday ? ' pcal-cell-today' : ''}${isPast ? ' pcal-cell-past' : ''}`}
                      key={dow}
                    >
                      {dayDate && (
                        <span className="pcal-cell-date">
                          {dayDate.getDate()}
                        </span>
                      )}
                      {activities.length === 0 && (
                        <span className="pcal-cell-empty" />
                      )}
                      {activities.map((a: any) => {
                        const details: string[] = [];
                        if (a.distance) details.push(`${a.distance}${a.distanceUnit === 'KM' ? 'km' : 'mi'}`);
                        if (a.duration) details.push(`${a.duration}m`);
                        if (a.paceTarget) details.push(a.paceTarget);
                        if (a.effortTarget) details.push(a.effortTarget);

                        return (
                          <div
                            className={`pcal-activity${a.completed ? ' pcal-activity-done' : ''}${a.mustDo || a.priority === 'KEY' ? ' pcal-activity-key' : ''}`}
                            key={a.id}
                          >
                            <span
                              className="pcal-activity-bar"
                              style={{ background: typeColor(a.type) }}
                            />
                            <div className="pcal-activity-content">
                              <span className="pcal-activity-title">{a.title}</span>
                              {details.length > 0 && (
                                <span className="pcal-activity-details">
                                  {details.join(' · ')}
                                </span>
                              )}
                              {a.rawText && a.rawText !== a.title && (
                                <span className="pcal-activity-notes">{a.rawText}</span>
                              )}
                              {a.subtype && (
                                <span className="pcal-activity-subtype">{a.subtype}</span>
                              )}
                            </div>
                            {a.completed && <span className="pcal-activity-check" />}
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
    </main>
  );
}
