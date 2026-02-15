'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ActivityTypeIcon from '@/components/ActivityTypeIcon';
import {
  convertDistanceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  type DistanceUnit
} from '@/lib/unit-display';

type PlanActivityRow = {
  id: string;
  title: string;
  type: string;
  distance: number | null;
  distanceUnit: string | null;
  duration: number | null;
  completed: boolean;
  matchedExternalActivityId?: string | null;
};

type StravaActivityRow = {
  id: string;
  name: string;
  sportType: string | null;
  startTime: string;
  distanceM: number | null;
  durationSec: number | null;
  avgHeartRate: number | null;
  matchedPlanActivityId?: string | null;
};

type ReviewDay = {
  date: string;
  label: string;
  isToday: boolean;
  isLockedPlanDay?: boolean;
  planActivities: PlanActivityRow[];
  stravaActivities: StravaActivityRow[];
};

type ReviewResponse = {
  viewerUnits?: 'MILES' | 'KM';
  account: {
    connected: boolean;
    providerUsername: string | null;
    lastSyncAt: string | null;
  };
  days: ReviewDay[];
};

function formatType(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function formatPlanActivity(activity: PlanActivityRow, viewerUnits: DistanceUnit) {
  const bits: string[] = [];
  if (activity.duration) bits.push(`${activity.duration} min`);
  if (activity.distance) {
    const converted = convertDistanceForDisplay(activity.distance, activity.distanceUnit, viewerUnits);
    if (converted) bits.push(`${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`);
  }
  if (activity.completed) bits.push('Done');
  return bits.join(' · ');
}

function formatStravaActivity(activity: StravaActivityRow, viewerUnits: DistanceUnit) {
  const bits: string[] = [];
  if (activity.distanceM && activity.distanceM > 0) {
    const converted = convertDistanceForDisplay(activity.distanceM / 1000, 'KM', viewerUnits);
    if (converted) bits.push(`${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`);
  }
  if (activity.durationSec && activity.durationSec > 0) {
    const min = Math.round(activity.durationSec / 60);
    bits.push(`${min} min`);
  }
  if (activity.avgHeartRate && activity.avgHeartRate > 0) bits.push(`${activity.avgHeartRate} bpm`);
  return bits.join(' · ');
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Never';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function StravaActivityMatchTable() {
  const router = useRouter();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [importedDates, setImportedDates] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/strava/review?ts=${Date.now()}`, {
        cache: 'no-store'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body?.error || 'Failed to load Strava table');
        return;
      }
      setData(body as ReviewResponse);
    } catch {
      setStatus('Failed to load Strava table');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshTable() {
    setImportedDates(new Set());
    await load();
  }

  async function syncRecent() {
    setSyncing(true);
    setStatus('Syncing Strava from plan start to today...');
    setImportedDates(new Set());
    try {
      const res = await fetch('/api/integrations/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncFromPlanStart: true })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body?.error || 'Sync failed');
        return;
      }
      const summary = body?.summary || {};
      const truncatedNote = summary?.truncated ? ' (partial window; rerun sync)' : '';
      setStatus(
        `Synced: ${summary.imported ?? 0} imported, ${summary.matched ?? 0} matched, ${summary.workoutsUpdated ?? 0} updated${truncatedNote}`
      );
      await load();
      router.refresh();
    } catch {
      setStatus('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function importDay(date: string) {
    setBusyDate(date);
    setStatus(`Importing ${date} from Strava...`);
    try {
      const res = await fetch('/api/integrations/strava/import-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body?.error || 'Import failed');
        return;
      }
      const summary = body?.summary || {};
      if ((summary.stravaActivities ?? 0) > 0) {
        setImportedDates((prev) => {
          const next = new Set(prev);
          next.add(date);
          return next;
        });
      }
      setStatus(
        `Imported ${summary.date}: ${summary.stravaActivities ?? 0} Strava activities, ${summary.matched ?? 0} matched, ${summary.workoutsUpdated ?? 0} workout logs updated`
      );
      await load();
      router.refresh();
    } catch {
      setStatus('Import failed');
    } finally {
      setBusyDate(null);
    }
  }

  const rows = useMemo(() => {
    const days = data?.days || [];
    return days
      .filter((day) => day.planActivities.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const syncHealth = useMemo(() => {
    if (!data?.account?.connected) return { label: 'Not connected', tone: 'off' as const };
    if (!data?.account?.lastSyncAt) return { label: 'Sync needed', tone: 'warn' as const };
    const lastSync = new Date(data.account.lastSyncAt);
    if (Number.isNaN(lastSync.getTime())) return { label: 'Sync needed', tone: 'warn' as const };
    const now = new Date();
    const diffMs = now.getTime() - lastSync.getTime();
    if (diffMs <= 6 * 60 * 60 * 1000) return { label: 'Up to date', tone: 'ok' as const };
    return { label: 'Sync recommended', tone: 'warn' as const };
  }, [data?.account?.connected, data?.account?.lastSyncAt]);
  const viewerUnits: DistanceUnit = data?.viewerUnits === 'KM' ? 'KM' : 'MILES';

  return (
    <section className="dash-card dash-day-import-card">
      <div className="dash-card-header">
        <div className="dash-day-import-title">
          <span className="dash-card-title">Import Strava</span>
          <span className={`dash-day-sync-health ${syncHealth.tone}`}>{syncHealth.label}</span>
        </div>
        <div className="dash-day-import-actions">
          <button
            className="dash-sync-btn"
            type="button"
            onClick={syncRecent}
            disabled={syncing || loading || !data?.account?.connected}
          >
            Sync Strava
          </button>
          <button className="dash-sync-btn" type="button" onClick={refreshTable} disabled={syncing || loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="dash-day-import-meta">
        <span>Strava: {data?.account?.providerUsername || 'Not connected'}</span>
        <span>Last sync: {formatDate(data?.account?.lastSyncAt)}</span>
      </div>

      {status && <p className="dash-sync-note">{status}</p>}

      {loading && <p className="dash-sync-note">Loading table...</p>}

      {!loading && !data?.account?.connected && (
        <p className="dash-sync-note">Connect Strava from the sync panel, then sync activities.</p>
      )}

      {!loading && data?.account?.connected && rows.length > 0 && (
        <div className="dash-day-table-wrap">
          <table className="dash-day-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Training Plan</th>
                <th>Strava (Same Day)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((day) => {
                const hasStrava = day.stravaActivities.length > 0;
                const dayLocked = Boolean(day.isLockedPlanDay);
                const importing = busyDate === day.date;
                const imported = importedDates.has(day.date);
                const matchedStravaCount = day.stravaActivities.filter((activity) => Boolean(activity.matchedPlanActivityId)).length;
                const matchedPlanCount = day.planActivities.filter((activity) => Boolean(activity.matchedExternalActivityId)).length;
                const completedPlanCount = day.planActivities.filter((activity) => activity.completed).length;
                const dayDone = hasStrava && matchedStravaCount > 0 && matchedStravaCount === day.stravaActivities.length;
                const dayPartial = hasStrava && matchedStravaCount > 0 && matchedStravaCount < day.stravaActivities.length;
                const actionLabel = dayLocked ? 'Locked' : dayDone ? 'Done' : imported ? 'Imported' : dayPartial ? 'Re-import' : 'Import';
                const rowClickable = hasStrava && !dayLocked && !dayDone && !imported && !importing;
                return (
                  <tr
                    key={day.date}
                    className={`${dayLocked ? 'day-status-locked' : dayDone ? 'day-status-done' : imported ? 'day-status-imported' : dayPartial ? 'day-status-partial' : ''}${rowClickable ? ' day-row-clickable' : ''}`.trim()}
                    role={rowClickable ? 'button' : undefined}
                    tabIndex={rowClickable ? 0 : undefined}
                    onClick={rowClickable ? () => importDay(day.date) : undefined}
                    onKeyDown={rowClickable ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void importDay(day.date);
                      }
                    } : undefined}
                  >
                    <td>
                      <div className="dash-day-date">
                        <strong>{day.label}</strong>
                        {day.isToday && <span>TODAY</span>}
                      </div>
                    </td>
                    <td>
                      <div className="dash-day-list">
                        {day.planActivities.map((activity) => (
                          <div
                            key={activity.id}
                            className={`dash-day-item${activity.completed ? ' done' : ''}`}
                          >
                            <div className="dash-day-item-head">
                              <strong>
                                <span className={`dash-type-icon type-${String(activity.type || 'OTHER').toLowerCase()}`}>
                                  <ActivityTypeIcon
                                    type={String(activity.type || 'OTHER')}
                                    className="dash-type-icon-glyph"
                                  />
                                </span>
                                {activity.title}
                              </strong>
                              <span className={`dash-day-plan-status ${activity.completed ? 'done' : 'pending'}`}>
                                {activity.completed ? 'Done' : 'Planned'}
                              </span>
                            </div>
                            <span>{formatType(activity.type)}</span>
                            {formatPlanActivity(activity, viewerUnits) && <em>{formatPlanActivity(activity, viewerUnits)}</em>}
                            {activity.matchedExternalActivityId && (
                              <em className="dash-day-match-note">Matched from Strava</em>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      {hasStrava ? (
                        <div className="dash-day-list">
                          {day.stravaActivities.map((activity) => (
                            <div key={activity.id} className="dash-day-item strava">
                              <strong>
                                <span className={`dash-type-icon type-${String(activity.sportType || 'OTHER').toLowerCase()}`}>
                                  <ActivityTypeIcon
                                    type={String(activity.sportType || 'OTHER')}
                                    className="dash-type-icon-glyph"
                                  />
                                </span>
                                {activity.name}
                              </strong>
                              <span>{formatType(activity.sportType || 'OTHER')}</span>
                              {formatStravaActivity(activity, viewerUnits) && <em>{formatStravaActivity(activity, viewerUnits)}</em>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="dash-day-empty">No Strava activity for this date</span>
                      )}
                    </td>
                    <td>
                      {hasStrava ? (
                        <div className="dash-day-action-stack">
                          <span className={`dash-day-status-chip ${dayLocked ? 'locked' : dayDone ? 'done' : imported ? 'imported' : dayPartial ? 'partial' : 'pending'}`}>
                            {dayLocked ? 'Locked' : dayDone ? 'Done' : imported ? 'Imported' : dayPartial ? 'Partial match' : 'Pending import'}
                          </span>
                          <span className="dash-day-action-meta">
                            {dayLocked
                              ? 'Completed day. Import and matching are disabled.'
                              : `${matchedStravaCount}/${day.stravaActivities.length} matched · ${completedPlanCount}/${day.planActivities.length} done`}
                          </span>
                          <button
                            className="dash-sync-btn"
                            type="button"
                            disabled={dayLocked || importing || dayDone || imported}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (dayLocked) return;
                              void importDay(day.date);
                            }}
                          >
                            {importing ? 'Importing...' : actionLabel}
                          </button>
                          {matchedPlanCount > 0 && (
                            <span className="dash-day-action-meta">
                              {matchedPlanCount} plan activities linked
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="dash-day-empty">Use normal workout log</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data?.account?.connected && rows.length === 0 && (
        <p className="dash-sync-note">No training-plan days found in the current window.</p>
      )}
    </section>
  );
}
