'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import './review.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVITY_TYPES = ['RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER'] as const;

type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number];

type ReviewActivity = {
  id: string;
  title: string;
  type: ActivityTypeValue;
  distance: number | null;
  duration: number | null;
  paceTarget: string | null;
  effortTarget: string | null;
  rawText: string | null;
  notes: string | null;
};

type ReviewDay = {
  id: string;
  weekId: string | null;
  dayOfWeek: number;
  rawText: string | null;
  notes: string | null;
  activities: ReviewActivity[];
};

type ReviewWeek = {
  id: string;
  weekIndex: number;
  days: ReviewDay[];
};

type ReviewPlan = {
  id: string;
  name: string;
  status: string;
  weeks: ReviewWeek[];
  days: ReviewDay[];
  activities: ReviewActivity[];
};

type ActivityDraft = {
  title: string;
  type: ActivityTypeValue;
  distance: string;
  duration: string;
  paceTarget: string;
  effortTarget: string;
  rawText: string;
};

function toActivityDraft(activity: ReviewActivity): ActivityDraft {
  return {
    title: activity.title || '',
    type: activity.type || 'OTHER',
    distance: activity.distance === null || activity.distance === undefined ? '' : String(activity.distance),
    duration: activity.duration === null || activity.duration === undefined ? '' : String(activity.duration),
    paceTarget: activity.paceTarget || '',
    effortTarget: activity.effortTarget || '',
    rawText: activity.rawText || ''
  };
}

function sortDays(days: ReviewDay[]) {
  return [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function applyActivityUpdateToPlan(
  plan: ReviewPlan,
  activityId: string,
  updater: (activity: ReviewActivity) => ReviewActivity
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => ({
        ...day,
        activities: day.activities.map((activity) =>
          activity.id === activityId ? updater(activity) : activity
        )
      }))
    })),
    days: plan.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) =>
        activity.id === activityId ? updater(activity) : activity
      )
    })),
    activities: plan.activities.map((activity) =>
      activity.id === activityId ? updater(activity) : activity
    )
  };
}

function applyDayUpdateToPlan(
  plan: ReviewPlan,
  dayId: string,
  updater: (day: ReviewDay) => ReviewDay
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => (day.id === dayId ? updater(day) : day))
    })),
    days: plan.days.map((day) => (day.id === dayId ? updater(day) : day))
  };
}

function appendActivityToDayPlan(
  plan: ReviewPlan,
  dayId: string,
  activity: ReviewActivity
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => (
        day.id === dayId
          ? { ...day, activities: [...(day.activities || []), activity] }
          : day
      ))
    })),
    days: plan.days.map((day) => (
      day.id === dayId
        ? { ...day, activities: [...(day.activities || []), activity] }
        : day
    )),
    activities: [...plan.activities, activity]
  };
}

function removeActivityFromPlan(
  plan: ReviewPlan,
  activityId: string
): ReviewPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => ({
        ...day,
        activities: day.activities.filter((activity) => activity.id !== activityId)
      }))
    })),
    days: plan.days.map((day) => ({
      ...day,
      activities: day.activities.filter((activity) => activity.id !== activityId)
    })),
    activities: plan.activities.filter((activity) => activity.id !== activityId)
  };
}

export default function PlanReviewPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const planId = Array.isArray(params?.id) ? params?.id[0] : params?.id;

  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dayDrafts, setDayDrafts] = useState<Record<string, string>>({});
  const [savingDayId, setSavingDayId] = useState<string | null>(null);

  const [activityDrafts, setActivityDrafts] = useState<Record<string, ActivityDraft>>({});
  const [savingActivityId, setSavingActivityId] = useState<string | null>(null);
  const [creatingDayId, setCreatingDayId] = useState<string | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);

  const initializeDrafts = useCallback((nextPlan: ReviewPlan) => {
    const nextDayDrafts: Record<string, string> = {};
    const nextActivityDrafts: Record<string, ActivityDraft> = {};

    for (const week of nextPlan.weeks || []) {
      for (const day of week.days || []) {
        nextDayDrafts[day.id] = day.rawText || '';
        for (const activity of day.activities || []) {
          nextActivityDrafts[activity.id] = toActivityDraft(activity);
        }
      }
    }

    setDayDrafts(nextDayDrafts);
    setActivityDrafts(nextActivityDrafts);
  }, []);

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/plans/${planId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || 'Failed to load plan.');
        return;
      }
      const fetchedPlan = data?.plan as ReviewPlan;
      setPlan(fetchedPlan);
      initializeDrafts(fetchedPlan);
    } catch {
      setError('Failed to load plan.');
    } finally {
      setLoading(false);
    }
  }, [planId, initializeDrafts]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get('parseWarning') === '1') {
      setNotice('Automatic parse could not complete. Fallback mode is active: review and add activities manually.');
    } else if (searchParams.get('fromUpload') === '1') {
      setNotice('Upload completed. Review and adjust activities before publishing.');
    }
  }, [searchParams]);

  const weeks = useMemo(() => {
    if (!plan?.weeks) return [];
    return [...plan.weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  }, [plan]);

  const unassigned = useMemo(() => {
    if (!plan?.days) return [];
    return plan.days.filter((day) => !day.weekId);
  }, [plan]);

  const summary = useMemo(() => {
    const totalWeeks = plan?.weeks?.length || 0;
    const totalActivities = plan?.activities?.length || 0;
    const unassignedCount = unassigned?.length || 0;
    return { totalWeeks, totalActivities, unassignedCount };
  }, [plan, unassigned]);

  const setActivityDraftField = useCallback(
    (activityId: string, field: keyof ActivityDraft, value: string) => {
      setActivityDrafts((prev) => {
        const current = prev[activityId];
        if (!current) return prev;
        return {
          ...prev,
          [activityId]: { ...current, [field]: value }
        };
      });
    },
    []
  );

  const saveDay = useCallback(
    async (dayId: string) => {
      if (!planId) return;
      setSavingDayId(dayId);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/days/${dayId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: dayDrafts[dayId] || '' })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to save day');
          return;
        }
        const updatedDay = data?.day as ReviewDay;
        setPlan((prev) => {
          if (!prev) return prev;
          return applyDayUpdateToPlan(prev, dayId, () => ({
            ...updatedDay,
            activities: updatedDay.activities as ReviewActivity[]
          }));
        });
        setDayDrafts((prev) => ({ ...prev, [dayId]: updatedDay.rawText || '' }));
        setNotice('Day updated');
      } catch {
        setError('Failed to save day');
      } finally {
        setSavingDayId(null);
      }
    },
    [planId, dayDrafts]
  );

  const saveActivity = useCallback(
    async (activityId: string) => {
      if (!planId) return;
      const draft = activityDrafts[activityId];
      if (!draft) return;
      if (!draft.title.trim()) {
        setError('Activity title is required');
        return;
      }

      const parsedDistance = draft.distance.trim() === '' ? null : Number(draft.distance);
      const parsedDuration = draft.duration.trim() === '' ? null : Number(draft.duration);

      if (parsedDistance !== null && (!Number.isFinite(parsedDistance) || parsedDistance < 0)) {
        setError('Distance must be a non-negative number');
        return;
      }

      if (
        parsedDuration !== null
        && (!Number.isFinite(parsedDuration) || parsedDuration < 0 || !Number.isInteger(parsedDuration))
      ) {
        setError('Duration must be a non-negative integer');
        return;
      }

      setSavingActivityId(activityId);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/activities/${activityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title.trim(),
            type: draft.type,
            distance: parsedDistance,
            duration: parsedDuration,
            paceTarget: draft.paceTarget.trim() || null,
            effortTarget: draft.effortTarget.trim() || null,
            rawText: draft.rawText.trim() || null
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to save activity');
          return;
        }
        const updatedActivity = data?.activity as ReviewActivity;
        setPlan((prev) => {
          if (!prev) return prev;
          return applyActivityUpdateToPlan(prev, activityId, () => updatedActivity);
        });
        setActivityDrafts((prev) => ({ ...prev, [activityId]: toActivityDraft(updatedActivity) }));
        setNotice('Activity updated');
      } catch {
        setError('Failed to save activity');
      } finally {
        setSavingActivityId(null);
      }
    },
    [activityDrafts, planId]
  );

  const addActivity = useCallback(
    async (dayId: string) => {
      if (!planId) return;
      setCreatingDayId(dayId);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/days/${dayId}/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to add activity');
          return;
        }
        const createdActivity = data?.activity as ReviewActivity;
        setPlan((prev) => (prev ? appendActivityToDayPlan(prev, dayId, createdActivity) : prev));
        setActivityDrafts((prev) => ({ ...prev, [createdActivity.id]: toActivityDraft(createdActivity) }));
        setNotice('Activity added');
      } catch {
        setError('Failed to add activity');
      } finally {
        setCreatingDayId(null);
      }
    },
    [planId]
  );

  const deleteActivity = useCallback(
    async (activityId: string) => {
      if (!planId) return;
      setDeletingActivityId(activityId);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/plans/${planId}/review/activities/${activityId}`, {
          method: 'DELETE'
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to delete activity');
          return;
        }
        setPlan((prev) => (prev ? removeActivityFromPlan(prev, activityId) : prev));
        setActivityDrafts((prev) => {
          const next = { ...prev };
          delete next[activityId];
          return next;
        });
        setNotice('Activity removed');
      } catch {
        setError('Failed to delete activity');
      } finally {
        setDeletingActivityId(null);
      }
    },
    [planId]
  );

  const handlePublish = useCallback(async () => {
    if (!planId) return;
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/plans/${planId}/publish`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Publish failed');
      window.location.href = '/dashboard';
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [planId]);

  if (loading) {
    return (
      <main className="review-page-shell">
        <section className="review-page-card">
          <p className="review-muted">Loading review workspace…</p>
        </section>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="review-page-shell">
        <section className="review-page-card">
          <p className="review-error">{error || 'Plan not found'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="review-page-shell">
      <section className="review-page-card review-hero">
        <div className="review-hero-head">
          <div>
            <h1>Review and Edit Before Publish</h1>
            <p>Plan: <strong>{plan.name}</strong> · Status: <strong>{plan.status}</strong></p>
          </div>
          <div className="review-hero-actions">
            <button className="cta" onClick={handlePublish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish Plan'}
            </button>
            <Link className="cta secondary" href={`/plans/${plan.id}`}>View Calendar</Link>
          </div>
        </div>

        <div className="review-stats-grid">
          <div>
            <strong>{summary.totalWeeks}</strong>
            <span>Weeks parsed</span>
          </div>
          <div>
            <strong>{summary.totalActivities}</strong>
            <span>Activities</span>
          </div>
          <div>
            <strong>{summary.unassignedCount}</strong>
            <span>Unassigned days</span>
          </div>
        </div>

        {notice && <p className="review-notice">{notice}</p>}
        {error && <p className="review-error">{error}</p>}
      </section>

      <section className="review-week-grid">
        {weeks.map((week) => {
          const days = sortDays(week.days || []);
          const weekActivityCount = days.reduce((sum, day) => sum + (day.activities?.length || 0), 0);
          return (
            <article key={week.id} className="review-page-card review-week-card">
              <div className="review-week-head">
                <h2>Week {week.weekIndex}</h2>
                <span>{weekActivityCount} activities</span>
              </div>

              {days.length === 0 && <p className="review-muted">No days parsed for this week.</p>}

              {days.map((day) => (
                <div key={day.id} className="review-day-block">
                  <div className="review-day-head">
                    <span className="review-day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</span>
                    <div className="review-day-actions">
                      <button
                        className="review-save-btn"
                        type="button"
                        onClick={() => addActivity(day.id)}
                        disabled={creatingDayId === day.id}
                      >
                        {creatingDayId === day.id ? 'Adding…' : 'Add Activity'}
                      </button>
                      <button
                        className="review-save-btn"
                        type="button"
                        onClick={() => saveDay(day.id)}
                        disabled={savingDayId === day.id}
                      >
                        {savingDayId === day.id ? 'Saving…' : 'Save Day'}
                      </button>
                    </div>
                  </div>

                  <label className="review-field">
                    <span>Day notes / source text</span>
                    <textarea
                      value={dayDrafts[day.id] || ''}
                      onChange={(event) =>
                        setDayDrafts((prev) => ({ ...prev, [day.id]: event.target.value }))
                      }
                      rows={2}
                    />
                  </label>

                  <div className="review-activity-list">
                    {(day.activities || []).map((activity) => {
                      const draft = activityDrafts[activity.id] || toActivityDraft(activity);
                      return (
                        <div key={activity.id} className="review-activity-item">
                          <div className="review-activity-top">
                            <strong>{activity.type.replace(/_/g, ' ')}</strong>
                            <div className="review-activity-actions">
                              <button
                                className="review-save-btn"
                                type="button"
                                onClick={() => saveActivity(activity.id)}
                                disabled={savingActivityId === activity.id}
                              >
                                {savingActivityId === activity.id ? 'Saving…' : 'Save Activity'}
                              </button>
                              <button
                                className="review-delete-btn"
                                type="button"
                                onClick={() => deleteActivity(activity.id)}
                                disabled={deletingActivityId === activity.id}
                              >
                                {deletingActivityId === activity.id ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          </div>

                          <div className="review-activity-grid">
                            <label className="review-field">
                              <span>Title</span>
                              <input
                                type="text"
                                value={draft.title}
                                onChange={(event) =>
                                  setActivityDraftField(activity.id, 'title', event.target.value)
                                }
                              />
                            </label>

                            <label className="review-field">
                              <span>Type</span>
                              <select
                                value={draft.type}
                                onChange={(event) =>
                                  setActivityDraftField(
                                    activity.id,
                                    'type',
                                    event.target.value as ActivityTypeValue
                                  )
                                }
                              >
                                {ACTIVITY_TYPES.map((type) => (
                                  <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                                ))}
                              </select>
                            </label>

                            <label className="review-field">
                              <span>Distance</span>
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                value={draft.distance}
                                onChange={(event) =>
                                  setActivityDraftField(activity.id, 'distance', event.target.value)
                                }
                              />
                            </label>

                            <label className="review-field">
                              <span>Duration (min)</span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={draft.duration}
                                onChange={(event) =>
                                  setActivityDraftField(activity.id, 'duration', event.target.value)
                                }
                              />
                            </label>

                            <label className="review-field">
                              <span>Pace target</span>
                              <input
                                type="text"
                                value={draft.paceTarget}
                                onChange={(event) =>
                                  setActivityDraftField(activity.id, 'paceTarget', event.target.value)
                                }
                                placeholder="e.g. 7:30 /mi"
                              />
                            </label>

                            <label className="review-field">
                              <span>Effort target</span>
                              <input
                                type="text"
                                value={draft.effortTarget}
                                onChange={(event) =>
                                  setActivityDraftField(activity.id, 'effortTarget', event.target.value)
                                }
                                placeholder="e.g. Z2"
                              />
                            </label>
                          </div>

                          <label className="review-field">
                            <span>Instructions</span>
                            <textarea
                              value={draft.rawText}
                              onChange={(event) =>
                                setActivityDraftField(activity.id, 'rawText', event.target.value)
                              }
                              rows={2}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </section>

      {unassigned.length > 0 && (
        <section className="review-page-card">
          <h3>Unassigned Days</h3>
          <div className="review-unassigned-list">
            {unassigned.map((day) => (
              <div key={day.id} className="review-unassigned-item">
                <span className="review-day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</span>
                <span>{day.rawText || 'No notes'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
