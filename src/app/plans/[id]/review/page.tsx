'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import './review.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVITY_TYPES = ['RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER'] as const;
const DISTANCE_UNITS = ['MILES', 'KM'] as const;
const RACE_DISTANCE_OPTIONS = [
  { value: '5', label: '5K' },
  { value: '10', label: '10K' },
  { value: '21.0975', label: 'Half Marathon (21.1K)' },
  { value: '42.195', label: 'Marathon (42.2K)' },
  { value: '50', label: '50K' }
] as const;

type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number];
type DistanceUnitValue = (typeof DISTANCE_UNITS)[number];

type ReviewActivity = {
  id: string;
  title: string;
  type: ActivityTypeValue;
  distance: number | null;
  distanceUnit: DistanceUnitValue | null;
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
  distanceUnit: DistanceUnitValue | '';
  duration: string;
  paceTarget: string;
  effortTarget: string;
  rawText: string;
};

function toActivityDraft(activity: ReviewActivity, fallbackUnit: DistanceUnitValue): ActivityDraft {
  return {
    title: activity.title || '',
    type: activity.type || 'OTHER',
    distance: activity.distance === null || activity.distance === undefined ? '' : String(activity.distance),
    distanceUnit: activity.distanceUnit || fallbackUnit,
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

function setFlag(
  previous: Record<string, boolean>,
  id: string,
  enabled: boolean
) {
  const next = { ...previous };
  if (enabled) next[id] = true;
  else delete next[id];
  return next;
}

function formatSavedTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
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
  const [expandedDayNotes, setExpandedDayNotes] = useState<Record<string, boolean>>({});
  const [savingDayIds, setSavingDayIds] = useState<Record<string, boolean>>({});
  const [queuedDayIds, setQueuedDayIds] = useState<Record<string, boolean>>({});

  const [activityDrafts, setActivityDrafts] = useState<Record<string, ActivityDraft>>({});
  const [savingActivityIds, setSavingActivityIds] = useState<Record<string, boolean>>({});
  const [queuedActivityIds, setQueuedActivityIds] = useState<Record<string, boolean>>({});
  const [creatingDayId, setCreatingDayId] = useState<string | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);
  const [viewerUnits, setViewerUnits] = useState<DistanceUnitValue>('MILES');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [showPacePersonalization, setShowPacePersonalization] = useState(false);
  const [paceFormOpen, setPaceFormOpen] = useState(false);
  const [paceApplying, setPaceApplying] = useState(false);
  const [paceRunCount, setPaceRunCount] = useState(0);
  const [raceDistanceKm, setRaceDistanceKm] = useState('42.195');
  const [goalHours, setGoalHours] = useState('3');
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [goalSeconds, setGoalSeconds] = useState('0');
  const [overrideExistingPaces, setOverrideExistingPaces] = useState(false);
  const [savePaceProfile, setSavePaceProfile] = useState(true);
  const [paceModalError, setPaceModalError] = useState<string | null>(null);

  const daySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const activitySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const initializeDrafts = useCallback((nextPlan: ReviewPlan, fallbackUnit: DistanceUnitValue) => {
    const nextDayDrafts: Record<string, string> = {};
    const nextExpandedDayNotes: Record<string, boolean> = {};
    const nextActivityDrafts: Record<string, ActivityDraft> = {};

    for (const week of nextPlan.weeks || []) {
      for (const day of week.days || []) {
        nextDayDrafts[day.id] = day.rawText || '';
        nextExpandedDayNotes[day.id] = true;
        for (const activity of day.activities || []) {
          nextActivityDrafts[activity.id] = toActivityDraft(activity, fallbackUnit);
        }
      }
    }

    setDayDrafts(nextDayDrafts);
    setExpandedDayNotes(nextExpandedDayNotes);
    setActivityDrafts(nextActivityDrafts);
  }, []);

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setSavingDayIds({});
    setQueuedDayIds({});
    setSavingActivityIds({});
    setQueuedActivityIds({});
    Object.values(daySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    Object.values(activitySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    daySaveTimersRef.current = {};
    activitySaveTimersRef.current = {};

    try {
      const res = await fetch(`/api/plans/${planId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || 'Failed to load plan.');
        return;
      }
      const fetchedPlan = data?.plan as ReviewPlan;
      const units = data?.viewerUnits === 'KM' ? 'KM' : 'MILES';
      setViewerUnits(units);
      setPlan(fetchedPlan);
      initializeDrafts(fetchedPlan, units);
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
    return () => {
      Object.values(daySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
      Object.values(activitySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
      daySaveTimersRef.current = {};
      activitySaveTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!searchParams) return;
    const parseWarningMsg = searchParams.get('parseWarningMsg');
    if (searchParams.get('parseWarning') === '1') {
      setNotice(
        parseWarningMsg
          ? `Automatic parse could not complete (${parseWarningMsg}). Fallback mode is active: review and add activities manually.`
          : 'Automatic parse could not complete. Fallback mode is active: review and add activities manually.'
      );
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

  const autosaveState = useMemo(() => {
    const queuedCount = Object.keys(queuedDayIds).length + Object.keys(queuedActivityIds).length;
    const savingCount = Object.keys(savingDayIds).length + Object.keys(savingActivityIds).length;
    const busy = queuedCount + savingCount > 0;
    const label = busy
      ? 'Saving changes…'
      : lastSavedAt
        ? `All changes saved at ${formatSavedTime(lastSavedAt)}`
        : 'Changes save automatically';
    return { busy, label };
  }, [lastSavedAt, queuedActivityIds, queuedDayIds, savingActivityIds, savingDayIds]);

  const persistDay = useCallback(
    async (dayId: string, rawText: string) => {
      if (!planId) return;

      setQueuedDayIds((prev) => setFlag(prev, dayId, false));
      setSavingDayIds((prev) => setFlag(prev, dayId, true));
      setError(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/days/${dayId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to autosave day notes');
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
        setLastSavedAt(Date.now());
      } catch {
        setError('Failed to autosave day notes');
      } finally {
        setSavingDayIds((prev) => setFlag(prev, dayId, false));
      }
    },
    [planId]
  );

  const queueDayAutosave = useCallback(
    (dayId: string, rawText: string) => {
      const existing = daySaveTimersRef.current[dayId];
      if (existing) clearTimeout(existing);
      setQueuedDayIds((prev) => setFlag(prev, dayId, true));
      daySaveTimersRef.current[dayId] = setTimeout(() => {
        delete daySaveTimersRef.current[dayId];
        void persistDay(dayId, rawText);
      }, 700);
    },
    [persistDay]
  );

  const setDayDraftField = useCallback(
    (dayId: string, value: string) => {
      setDayDrafts((prev) => ({ ...prev, [dayId]: value }));
      queueDayAutosave(dayId, value);
    },
    [queueDayAutosave]
  );

  const persistActivity = useCallback(
    async (activityId: string, draft: ActivityDraft) => {
      if (!planId) return;
      if (!draft.title.trim()) return;

      const parsedDistance = draft.distance.trim() === '' ? null : Number(draft.distance);
      const parsedDuration = draft.duration.trim() === '' ? null : Number(draft.duration);

      if (parsedDistance !== null && (!Number.isFinite(parsedDistance) || parsedDistance < 0)) return;
      if (
        parsedDuration !== null
        && (!Number.isFinite(parsedDuration) || parsedDuration < 0 || !Number.isInteger(parsedDuration))
      ) return;

      const resolvedDistanceUnit = (draft.distanceUnit || viewerUnits) as DistanceUnitValue;
      setQueuedActivityIds((prev) => setFlag(prev, activityId, false));
      setSavingActivityIds((prev) => setFlag(prev, activityId, true));
      setError(null);

      try {
        const res = await fetch(`/api/plans/${planId}/review/activities/${activityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title.trim(),
            type: draft.type,
            distance: parsedDistance,
            distanceUnit: parsedDistance === null ? null : resolvedDistanceUnit,
            duration: parsedDuration,
            paceTarget: draft.paceTarget.trim() || null,
            effortTarget: draft.effortTarget.trim() || null,
            rawText: draft.rawText.trim() || null
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || 'Failed to autosave activity');
          return;
        }
        const updatedActivity = data?.activity as ReviewActivity;
        setPlan((prev) => {
          if (!prev) return prev;
          return applyActivityUpdateToPlan(prev, activityId, () => updatedActivity);
        });
        setLastSavedAt(Date.now());
      } catch {
        setError('Failed to autosave activity');
      } finally {
        setSavingActivityIds((prev) => setFlag(prev, activityId, false));
      }
    },
    [planId, viewerUnits]
  );

  const queueActivityAutosave = useCallback(
    (activityId: string, draft: ActivityDraft) => {
      const existing = activitySaveTimersRef.current[activityId];
      if (existing) clearTimeout(existing);
      setQueuedActivityIds((prev) => setFlag(prev, activityId, true));
      activitySaveTimersRef.current[activityId] = setTimeout(() => {
        delete activitySaveTimersRef.current[activityId];
        void persistActivity(activityId, draft);
      }, 700);
    },
    [persistActivity]
  );

  const setActivityDraftField = useCallback(
    (activityId: string, field: keyof ActivityDraft, value: string) => {
      setActivityDrafts((prev) => {
        const current = prev[activityId];
        if (!current) return prev;
        const nextDraft = { ...current, [field]: value };
        queueActivityAutosave(activityId, nextDraft);
        return {
          ...prev,
          [activityId]: nextDraft
        };
      });
    },
    [queueActivityAutosave]
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
        setActivityDrafts((prev) => ({ ...prev, [createdActivity.id]: toActivityDraft(createdActivity, viewerUnits) }));
        setNotice('Activity added');
      } catch {
        setError('Failed to add activity');
      } finally {
        setCreatingDayId(null);
      }
    },
    [planId, viewerUnits]
  );

  const deleteActivity = useCallback(
    async (activityId: string) => {
      if (!planId) return;
      const timer = activitySaveTimersRef.current[activityId];
      if (timer) {
        clearTimeout(timer);
        delete activitySaveTimersRef.current[activityId];
      }
      setQueuedActivityIds((prev) => setFlag(prev, activityId, false));
      setSavingActivityIds((prev) => setFlag(prev, activityId, false));
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
        setLastSavedAt(Date.now());
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
    if (autosaveState.busy) {
      setError('Please wait until all autosave changes are complete before publishing.');
      return;
    }
    setPublishing(true);
    setError(null);
    setNotice(null);

    Object.values(daySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    Object.values(activitySaveTimersRef.current).forEach((timer) => clearTimeout(timer));
    daySaveTimersRef.current = {};
    activitySaveTimersRef.current = {};
    setQueuedDayIds({});
    setQueuedActivityIds({});

    try {
      const res = await fetch(`/api/plans/${planId}/publish`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Publish failed');
      const runCount = Number(data?.runActivityCount || 0);
      setPlan((prev) => (prev ? { ...prev, status: 'ACTIVE' } : prev));
      setPaceRunCount(runCount);
      if (runCount > 0) {
        setShowPacePersonalization(true);
        setPaceFormOpen(false);
        setNotice('Plan published. Continue to dashboard or personalize run paces now.');
        return;
      }
      window.location.href = '/dashboard';
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [autosaveState.busy, planId]);

  const skipPacePersonalization = useCallback(() => {
    window.location.href = '/dashboard';
  }, []);

  const applyPacePersonalization = useCallback(async () => {
    if (!planId) return;

    const numericDistance = Number(raceDistanceKm);
    const numericHours = Number(goalHours || 0);
    const numericMinutes = Number(goalMinutes || 0);
    const numericSeconds = Number(goalSeconds || 0);

    if (!Number.isFinite(numericDistance) || numericDistance <= 0) {
      setPaceModalError('Race distance must be greater than 0.');
      return;
    }
    if (![numericHours, numericMinutes, numericSeconds].every((value) => Number.isFinite(value) && value >= 0)) {
      setPaceModalError('Race target time is invalid.');
      return;
    }
    if (numericMinutes >= 60 || numericSeconds >= 60) {
      setPaceModalError('Minutes and seconds must be lower than 60.');
      return;
    }
    if (numericHours * 3600 + numericMinutes * 60 + numericSeconds < 600) {
      setPaceModalError('Please set a race target of at least 10 minutes.');
      return;
    }

    setPaceApplying(true);
    setPaceModalError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/pace-personalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceDistanceKm: numericDistance,
          goalHours: numericHours,
          goalMinutes: numericMinutes,
          goalSeconds: numericSeconds,
          overrideExisting: overrideExistingPaces,
          saveToProfile: savePaceProfile
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPaceModalError(data?.error || 'Failed to personalize paces.');
        return;
      }
      const personalized = Number(data?.summary?.updated || 0);
      setNotice(`Pace targets personalized for ${personalized} run activities.`);
      window.location.href = '/dashboard';
    } catch {
      setPaceModalError('Failed to personalize paces.');
    } finally {
      setPaceApplying(false);
    }
  }, [
    goalHours,
    goalMinutes,
    goalSeconds,
    overrideExistingPaces,
    planId,
    raceDistanceKm,
    savePaceProfile
  ]);

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
            <button className="cta" onClick={handlePublish} disabled={publishing || autosaveState.busy}>
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

        <p className={`review-autosave ${autosaveState.busy ? 'busy' : ''}`}>{autosaveState.label}</p>

        {notice && <p className="review-notice">{notice}</p>}
        {error && <p className="review-error">{error}</p>}
      </section>

      {showPacePersonalization && (
        <section className="review-page-card review-publish-panel">
          <div className="review-publish-head">
            <div>
              <h3>Plan Published</h3>
              <p>
                {paceRunCount > 0
                  ? `Your plan is active with ${paceRunCount} run activities.`
                  : 'Your plan is now active.'}
              </p>
            </div>
            <div className="review-publish-actions">
              <button className="cta" type="button" onClick={skipPacePersonalization}>
                Go to Today
              </button>
              {paceRunCount > 0 && (
                <button className="cta secondary" type="button" onClick={() => setPaceFormOpen((prev) => !prev)}>
                  {paceFormOpen ? 'Hide Pace Setup' : 'Personalize Paces'}
                </button>
              )}
            </div>
          </div>

          {paceRunCount > 0 && paceFormOpen && (
            <div className="review-publish-body">
              <p className="review-publish-copy">
                Set a race target and CoachPlan will auto-fill pace targets in {viewerUnits === 'KM' ? 'min/km' : 'min/mi'}.
              </p>
              <div className="review-modal-grid">
                <label className="review-field">
                  <span>Goal race distance</span>
                  <select value={raceDistanceKm} onChange={(event) => setRaceDistanceKm(event.target.value)}>
                    {RACE_DISTANCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="review-field">
                  <span>Target time (hh:mm:ss)</span>
                  <div className="review-time-input-row">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={goalHours}
                      onChange={(event) => setGoalHours(event.target.value)}
                      placeholder="hh"
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      value={goalMinutes}
                      onChange={(event) => setGoalMinutes(event.target.value)}
                      placeholder="mm"
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      value={goalSeconds}
                      onChange={(event) => setGoalSeconds(event.target.value)}
                      placeholder="ss"
                    />
                  </div>
                </label>

                <label className="review-check-row">
                  <input
                    type="checkbox"
                    checked={overrideExistingPaces}
                    onChange={(event) => setOverrideExistingPaces(event.target.checked)}
                  />
                  <span>Override existing pace targets already parsed from the source plan</span>
                </label>

                <label className="review-check-row">
                  <input
                    type="checkbox"
                    checked={savePaceProfile}
                    onChange={(event) => setSavePaceProfile(event.target.checked)}
                  />
                  <span>Save generated pace profile to athlete settings for next plans</span>
                </label>
              </div>

              {paceModalError && <p className="review-error">{paceModalError}</p>}

              <div className="review-modal-actions">
                <button className="cta secondary" type="button" onClick={skipPacePersonalization} disabled={paceApplying}>
                  Skip for now
                </button>
                <button className="cta" type="button" onClick={applyPacePersonalization} disabled={paceApplying}>
                  {paceApplying ? 'Applying…' : 'Apply Pace Targets'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {!showPacePersonalization && (
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

              {days.map((day) => {
                const notesOpen = expandedDayNotes[day.id] ?? true;
                return (
                  <div key={day.id} className="review-day-block">
                    <div className="review-day-head">
                      <span className="review-day-pill">{DAY_LABELS[(day.dayOfWeek || 1) - 1] || 'Day'}</span>
                      <div className="review-day-actions">
                        <button
                          className="review-save-btn secondary"
                          type="button"
                          onClick={() =>
                            setExpandedDayNotes((prev) => ({ ...prev, [day.id]: !notesOpen }))
                          }
                        >
                          {notesOpen ? 'Hide Notes' : 'Show Notes'}
                        </button>
                        <button
                          className="review-save-btn"
                          type="button"
                          onClick={() => addActivity(day.id)}
                          disabled={creatingDayId === day.id}
                        >
                          {creatingDayId === day.id ? 'Adding…' : 'Add Activity'}
                        </button>
                      </div>
                    </div>

                    {notesOpen && (
                      <label className="review-field review-day-notes">
                        <span>Day notes / source text</span>
                        <textarea
                          value={dayDrafts[day.id] || ''}
                          onChange={(event) =>
                            setDayDraftField(day.id, event.target.value)
                          }
                          rows={2}
                        />
                      </label>
                    )}

                    <div className="review-activity-list">
                      {(day.activities || []).map((activity) => {
                        const draft = activityDrafts[activity.id] || toActivityDraft(activity, viewerUnits);
                        const paceUnitLabel = (draft.distanceUnit || viewerUnits) === 'KM' ? 'km' : 'mi';
                        const hasDistance = draft.distance.trim() !== '';
                        const activitySaving = Boolean(savingActivityIds[activity.id] || queuedActivityIds[activity.id]);
                        return (
                          <div key={activity.id} className="review-activity-item review-activity-item-compact">
                            <div className="review-activity-top">
                              <strong>{activity.type.replace(/_/g, ' ')}</strong>
                              <div className="review-activity-actions">
                                {activitySaving && <span className="review-inline-status">Saving…</span>}
                                <button
                                  className="review-delete-btn text"
                                  type="button"
                                  onClick={() => deleteActivity(activity.id)}
                                  disabled={deletingActivityId === activity.id}
                                >
                                  {deletingActivityId === activity.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>

                            <div className="review-activity-grid">
                              <label className="review-field review-col-title">
                                <span>Title</span>
                                <input
                                  type="text"
                                  value={draft.title}
                                  onChange={(event) =>
                                    setActivityDraftField(activity.id, 'title', event.target.value)
                                  }
                                />
                              </label>

                            <label className="review-field review-col-type">
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

                            <label className="review-field review-col-distance">
                              <span>Distance</span>
                              <div className={`review-distance-input-row${hasDistance ? '' : ' single'}`}>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.1"
                                  value={draft.distance}
                                  onChange={(event) =>
                                    setActivityDraftField(activity.id, 'distance', event.target.value)
                                  }
                                />
                                {hasDistance && (
                                  <select
                                    value={draft.distanceUnit || viewerUnits}
                                    onChange={(event) =>
                                      setActivityDraftField(activity.id, 'distanceUnit', event.target.value)
                                    }
                                  >
                                    {DISTANCE_UNITS.map((unit) => (
                                      <option key={unit} value={unit}>{unit === 'KM' ? 'km' : 'mi'}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                              <small className="review-field-hint">
                                {hasDistance
                                  ? 'Unit is auto-set by parser/profile. Change only if needed.'
                                  : `Unit will default to ${viewerUnits === 'KM' ? 'km' : 'mi'} once distance is entered.`}
                              </small>
                            </label>

                            <label className="review-field review-col-duration">
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

                            <label className="review-field review-col-pace">
                              <span>Pace target</span>
                              <input
                                type="text"
                                value={draft.paceTarget}
                                onChange={(event) =>
                                  setActivityDraftField(activity.id, 'paceTarget', event.target.value)
                                }
                                placeholder={`e.g. ${paceUnitLabel === 'km' ? '4:45' : '7:30'} /${paceUnitLabel}`}
                              />
                            </label>

                            <label className="review-field review-col-effort">
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

                            <label className="review-field review-col-instructions">
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
                );
              })}
            </article>
          );
          })}
        </section>
      )}

      {!showPacePersonalization && unassigned.length > 0 && (
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
