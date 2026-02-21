'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import CompleteWorkoutButton from '@/components/CompleteWorkoutButton';
import type { DayStatus } from '@/lib/day-status';

type LogActivity = {
  id: string;
  title: string | null;
  type: string;
  completed: boolean;
  plannedDetails: string[];
  plannedNotes: string | null;
  paceCategory: string | null;
  plannedDistance: number | null;
  plannedDuration: number | null;
  actualDistance: number | null;
  actualDuration: number | null;
  actualPace: string | null;
};

type StravaImportSummary = {
  date: string;
  stravaActivities: number;
  matched: number;
  workoutsUpdated: number;
  unmatched: number;
};

type SyncTone = 'info' | 'success' | 'warning' | 'error';

const TYPE_ABBR: Record<string, string> = {
  RUN: 'RUN',
  STRENGTH: 'STR',
  CROSS_TRAIN: 'XT',
  REST: 'RST',
  MOBILITY: 'MOB',
  YOGA: 'YOG',
  HIKE: 'HIK',
  OTHER: 'OTH'
};

function typeAbbr(type: string | null | undefined) {
  return TYPE_ABBR[String(type || 'OTHER').toUpperCase()] || 'OTH';
}

function normalizeTypeClass(type: string | null | undefined) {
  return String(type || 'OTHER').toLowerCase();
}

function formatDayStatus(status: DayStatus) {
  if (status === 'DONE') return 'Done';
  if (status === 'MISSED') return 'Missed';
  return 'Open';
}

function summarizeImport(summary: StravaImportSummary) {
  if (summary.stravaActivities === 0) return 'No Strava activities found for this day.';
  const noun = summary.stravaActivities === 1 ? 'activity' : 'activities';
  return `Synced ${summary.stravaActivities} ${noun} · ${summary.matched} matched · ${summary.workoutsUpdated} updated · ${summary.unmatched} unmatched`;
}

export default function DashboardActivityLogCard({
  anchorId = 'dash-activity-log-card',
  dateLabel,
  dateISO,
  planId,
  dayId,
  viewerUnits,
  activities,
  initialDayStatus,
  initialMissedReason,
  stravaConnected
}: {
  anchorId?: string;
  dateLabel: string;
  dateISO: string;
  planId: string;
  dayId: string | null;
  viewerUnits: 'KM' | 'MILES';
  activities: LogActivity[];
  initialDayStatus: DayStatus;
  initialMissedReason?: string | null;
  stravaConnected: boolean;
}) {
  const router = useRouter();
  const hashTarget = `#${anchorId}`;

  const [open, setOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncTone, setSyncTone] = useState<SyncTone>('info');
  const [dayBusy, setDayBusy] = useState(false);
  const [dayStatus, setDayStatus] = useState<DayStatus>(initialDayStatus);
  const [missedReason, setMissedReason] = useState(initialMissedReason || '');
  const [dayError, setDayError] = useState<string | null>(null);
  const [closeActionsOpen, setCloseActionsOpen] = useState(
    initialDayStatus !== 'OPEN' || activities.length === 0
  );
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const hasActivities = activities.length > 0;
  const completedCount = useMemo(() => activities.filter((activity) => activity.completed).length, [activities]);
  const remainingCount = Math.max(0, activities.length - completedCount);

  useEffect(() => {
    setDayStatus(initialDayStatus);
  }, [initialDayStatus]);

  useEffect(() => {
    setMissedReason(initialMissedReason || '');
  }, [initialMissedReason]);

  useEffect(() => {
    if (dayStatus !== 'OPEN') {
      setCloseActionsOpen(true);
    }
  }, [dayStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const openFromHash = () => {
      if (window.location.hash === hashTarget) setOpen(true);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [hashTarget]);

  const closeCard = () => {
    setOpen(false);
    setDayError(null);
    if (typeof window !== 'undefined' && window.location.hash === hashTarget) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  const toggleNotes = (activityId: string) => {
    setExpandedNotes((prev) => ({ ...prev, [activityId]: !prev[activityId] }));
  };

  const syncFromStrava = async () => {
    if (syncBusy) return;

    if (!stravaConnected) {
      setSyncTone('warning');
      setSyncMessage('Connect Strava first to auto-match this day. You can still log workouts manually below.');
      return;
    }

    setSyncBusy(true);
    setSyncTone('info');
    setSyncMessage(null);
    try {
      const res = await fetch('/api/integrations/strava/import-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateISO, planId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncTone('error');
        setSyncMessage(body?.error || 'Failed to sync Strava day log');
        return;
      }
      const summary = body?.summary as StravaImportSummary | undefined;
      if (summary) {
        setSyncTone(summary.stravaActivities === 0 ? 'warning' : 'success');
        setSyncMessage(summarizeImport(summary));
      } else {
        setSyncTone('success');
        setSyncMessage('Strava sync complete.');
      }
      router.refresh();
    } catch {
      setSyncTone('error');
      setSyncMessage('Failed to sync Strava day log');
    } finally {
      setSyncBusy(false);
    }
  };

  const saveDayStatus = async (nextStatus: DayStatus) => {
    if (!dayId || dayBusy) return;
    setDayBusy(true);
    setDayError(null);
    try {
      const res = await fetch(`/api/plan-days/${dayId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          reason: nextStatus === 'MISSED' ? missedReason : null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDayError(data?.error || 'Failed to update day status');
        return;
      }
      const status = data?.day?.status as DayStatus | undefined;
      setDayStatus(status || nextStatus);
      setMissedReason(typeof data?.day?.reason === 'string' ? data.day.reason : '');
      router.refresh();
    } catch {
      setDayError('Failed to update day status');
    } finally {
      setDayBusy(false);
    }
  };

  return (
    <section id={anchorId} className={`dash-card dash-activity-log-card${open ? '' : ' is-closed'}`}>
      <div className="dash-card-header">
        <span className="dash-card-title">Activity Log</span>
        <span className="dash-activity-log-date">{dateLabel}</span>
      </div>

      {!open ? (
        <div className="dash-activity-log-collapsed">
          <p>
            Log today&apos;s training here. Planned workout details, Strava re-sync, and day closure all stay in dashboard.
          </p>
          <button type="button" className="dash-btn-primary" onClick={() => setOpen(true)}>
            Open Activity Log
          </button>
        </div>
      ) : (
        <>
          <div className="dash-activity-log-head-actions">
            <button type="button" className="dash-btn-secondary" onClick={closeCard}>
              Cancel &amp; Close
            </button>
          </div>

          <div className="dash-activity-log-sections">
            <section className="dash-activity-log-block">
              <div className="dash-activity-log-block-head">
                <h3>1. Planned Today</h3>
                <span>{hasActivities ? `${completedCount}/${activities.length} logged` : 'No planned workouts'}</span>
              </div>
              <p className="dash-activity-log-block-copy">
                {hasActivities
                  ? remainingCount > 0
                    ? `${remainingCount} workout${remainingCount === 1 ? '' : 's'} still to log for this day.`
                    : 'All planned workouts are logged. You can close the day when ready.'
                  : 'No workout is scheduled on this day. You can sync from Strava or close the day manually.'}
              </p>

              {!hasActivities ? (
                <p className="dash-activity-log-empty">No planned activities found for today.</p>
              ) : (
                <div className="dash-activity-log-list">
                  {activities.map((activity) => (
                    <article key={`log-${activity.id}`} className="dash-activity-log-item">
                      <div className="dash-activity-log-item-top">
                        <div className="dash-activity-log-item-copy">
                          <h4>{activity.title || activity.type}</h4>
                          <p>
                            {activity.plannedDetails.length > 0
                              ? activity.plannedDetails.join(' · ')
                              : 'No planned metrics'}
                          </p>
                        </div>
                        <div className="dash-activity-log-item-tags">
                          <span
                            className={`dash-type-pill type-${normalizeTypeClass(activity.type)}`}
                            title={activity.type}
                          >
                            {typeAbbr(activity.type)}
                          </span>
                          {activity.paceCategory && (
                            <span className="dash-activity-log-tag">Pace category: {activity.paceCategory}</span>
                          )}
                        </div>
                      </div>

                      {activity.plannedNotes && (
                        <div className="dash-activity-log-notes-wrap">
                          <button
                            type="button"
                            className="dash-activity-log-note-toggle"
                            aria-expanded={Boolean(expandedNotes[activity.id])}
                            onClick={() => toggleNotes(activity.id)}
                          >
                            {expandedNotes[activity.id] ? 'Hide plan notes' : 'Show plan notes'}
                          </button>
                          {expandedNotes[activity.id] && (
                            <p className="dash-activity-log-notes">{activity.plannedNotes}</p>
                          )}
                        </div>
                      )}

                      <div className="dash-activity-log-item-actions">
                        <CompleteWorkoutButton
                          activityId={activity.id}
                          completed={activity.completed}
                          actualDistance={activity.actualDistance}
                          actualDuration={activity.actualDuration}
                          actualPace={activity.actualPace}
                          plannedDistance={activity.plannedDistance}
                          plannedDuration={activity.plannedDuration}
                          distanceUnit={viewerUnits}
                        />
                        {activity.completed && <span className="dash-activity-log-status">Completed</span>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="dash-activity-log-block">
              <div className="dash-activity-log-block-head">
                <h3>2. Sync &amp; Match</h3>
                <span>{stravaConnected ? 'Strava connected' : 'Strava not connected'}</span>
              </div>
              <p className="dash-activity-log-block-copy">
                Re-sync this day to prefill workout actuals from Strava. If no matching activity exists, log manually.
              </p>
              <div className="dash-activity-log-toolbar">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={syncFromStrava}
                  disabled={syncBusy || !stravaConnected}
                >
                  {syncBusy ? 'Syncing Strava…' : 'Re-sync from Strava'}
                </button>
                {!stravaConnected && (
                  <a className="dash-btn-secondary" href="/profile">
                    Connect Strava
                  </a>
                )}
                <a className="dash-btn-secondary" href={`/plans/${planId}`}>
                  Review Plan
                </a>
              </div>
              {syncMessage && (
                <p className={`dash-activity-log-sync-note ${syncTone}`} role="status" aria-live="polite">
                  {syncMessage}
                </p>
              )}
            </section>

            <section className="dash-activity-log-block">
              <div className="dash-activity-log-block-head">
                <h3>3. Log &amp; Close Day</h3>
                <strong className={`dash-activity-log-day-pill status-${dayStatus.toLowerCase()}`}>
                  {formatDayStatus(dayStatus)}
                </strong>
              </div>
              <p className="dash-activity-log-block-copy">
                Close the day after logging workouts. Use Missed when the planned day could not be completed.
              </p>

              <button
                type="button"
                className="dash-btn-secondary"
                onClick={() => setCloseActionsOpen((prev) => !prev)}
                aria-expanded={closeActionsOpen}
              >
                {closeActionsOpen ? 'Hide day close options' : 'Show day close options'}
              </button>

              {closeActionsOpen && (
                <div className="dash-activity-log-day-state">
                  <label className="dash-activity-log-reason-label" htmlFor="dash-day-missed-reason">
                    Missed reason (optional)
                  </label>
                  <textarea
                    id="dash-day-missed-reason"
                    className="dash-activity-log-reason"
                    value={missedReason}
                    onChange={(event) => setMissedReason(event.target.value)}
                    placeholder="Example: travel, illness, schedule conflict"
                    maxLength={240}
                    disabled={dayBusy || !dayId}
                  />

                  <div className="dash-activity-log-day-actions">
                    <button
                      type="button"
                      className="dash-sync-btn"
                      onClick={() => saveDayStatus('DONE')}
                      disabled={dayBusy || !dayId || dayStatus === 'DONE'}
                    >
                      {dayStatus === 'DONE' ? 'Day Done' : 'Mark Day Done'}
                    </button>
                    <button
                      type="button"
                      className="dash-sync-btn is-warning"
                      onClick={() => saveDayStatus('MISSED')}
                      disabled={dayBusy || !dayId}
                    >
                      {dayStatus === 'MISSED' ? 'Update Missed Day' : 'Close as Missed'}
                    </button>
                    {dayStatus !== 'OPEN' && (
                      <button
                        type="button"
                        className="dash-sync-btn is-neutral"
                        onClick={() => saveDayStatus('OPEN')}
                        disabled={dayBusy || !dayId}
                      >
                        Reopen Day
                      </button>
                    )}
                  </div>

                  {!dayId && (
                    <p className="dash-activity-log-day-hint">
                      This date is outside the currently active week, so day status cannot be updated here.
                    </p>
                  )}
                  {dayError && (
                    <p className="dash-activity-log-day-error" role="status" aria-live="polite">
                      {dayError}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
