'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PlanReviewPage() {
  const params = useParams<{ id: string }>();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  const [plan, setPlan] = useState<any>(null);
  const [publishing, setPublishing] = useState(false);
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

  const weeks = useMemo(() => {
    if (!plan?.weeks) return [];
    return [...plan.weeks].sort((a: any, b: any) => a.weekIndex - b.weekIndex);
  }, [plan]);

  const unassigned = useMemo(() => {
    if (!plan?.days) return [];
    return plan.days.filter((d: any) => !d.weekId);
  }, [plan]);

  const summary = useMemo(() => {
    const totalWeeks = plan?.weeks?.length || 0;
    const totalActivities = plan?.activities?.length || 0;
    const unassignedCount = unassigned?.length || 0;
    return { totalWeeks, totalActivities, unassignedCount };
  }, [plan, unassigned]);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/publish`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Publish failed');
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  if (!plan) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <section className="card white">
        <div className="review-header">
          <div>
            <div className="section-title">
              <h1>Review parsed plan</h1>
            </div>
            <p className="muted">
              Check weeks and workouts before publishing. Plan: <strong>{plan.name}</strong>
            </p>
          </div>
          <div className="review-actions">
            <button className="cta" onClick={handlePublish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish plan'}
            </button>
            <a className="cta secondary" href={`/plans/${plan.id}`}>View detail</a>
          </div>
        </div>
        <div className="review-stats">
          <div className="stat-card">
            <strong>{summary.totalWeeks}</strong>
            <span className="muted">Weeks parsed</span>
          </div>
          <div className="stat-card">
            <strong>{summary.totalActivities}</strong>
            <span className="muted">Activities</span>
          </div>
          <div className="stat-card">
            <strong>{summary.unassignedCount}</strong>
            <span className="muted">Unassigned</span>
          </div>
        </div>
        {error && (
          <p className="muted" style={{ marginTop: 10, color: '#b42318' }}>{error}</p>
        )}
      </section>

      <section className="container" style={{ marginTop: 24 }}>
        <div className="review-grid">
          {weeks.map((week: any) => {
            const days = [...(week.days || [])].sort((a: any, b: any) => a.dayOfWeek - b.dayOfWeek);
            const activityCount = days.reduce(
              (acc: number, d: any) => acc + (d.activities?.length || 0),
              0
            );
            return (
              <div className="week-card" key={week.id}>
                <div className="week-meta">
                  <span>Week {week.weekIndex}</span>
                  <span className="muted">{activityCount} activities</span>
                </div>
                {days.length === 0 && (
                  <p className="muted">No days parsed for this week.</p>
                )}
                {days.map((day: any) => (
                  <div className="day-row" key={day.id}>
                    <div className="day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</div>
                    <div className="workout-text">
                      <span>{day.rawText || 'No notes'}</span>
                      {(day.activities || []).map((a: any) => (
                        <span key={a.id} className="workout-badge">{a.subtype || a.type}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {unassigned.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title">
              <h3>Unassigned days</h3>
            </div>
            {unassigned.map((day: any) => (
              <div className="day-row" key={day.id}>
                <div className="day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</div>
                <div className="workout-text">
                  <span>{day.rawText || 'No notes'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
