'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ActivityTypeIcon from '@/components/ActivityTypeIcon';
import ExternalSportIcon from '@/components/ExternalSportIcon';
import { getExternalSportVisual } from '@/lib/integrations/external-sport-visuals';
import {
  convertDistanceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit
} from '@/lib/unit-display';
import { SELECTED_PLAN_COOKIE } from '@/lib/plan-selection';

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
  equivalence?: 'FULL' | 'PARTIAL' | 'NONE' | null;
  equivalenceOverride?: 'FULL' | 'PARTIAL' | 'NONE' | null;
  equivalenceNote?: string | null;
  equivalenceConfidence?: number | null;
  loadRatio?: number | null;
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
  plan?: {
    id: string;
    name: string;
  } | null;
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

function formatStravaSportType(type: string | null | undefined) {
  return getExternalSportVisual('STRAVA', type).label;
}

function formatPlanActivity(activity: PlanActivityRow, viewerUnits: DistanceUnit) {
  const bits: string[] = [];
  if (activity.duration) bits.push(`${activity.duration} min`);
  if (activity.distance) {
    const sourceUnit = resolveDistanceUnitFromActivity({
      distanceUnit: activity.distanceUnit,
      fallbackUnit: viewerUnits
    }) || viewerUnits;
    const converted = convertDistanceForDisplay(activity.distance, sourceUnit, viewerUnits);
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

function resolveEquivalence(activity: StravaActivityRow) {
  return activity.equivalenceOverride || activity.equivalence || null;
}

function equivalenceLabel(value: 'FULL' | 'PARTIAL' | 'NONE' | null) {
  if (value === 'FULL') return 'Counts fully';
  if (value === 'PARTIAL') return 'Counts partially';
  if (value === 'NONE') return 'Does not count';
  return 'Not evaluated';
}

function equivalenceClass(value: 'FULL' | 'PARTIAL' | 'NONE' | null) {
  if (value === 'FULL') return 'done';
  if (value === 'PARTIAL') return 'partial';
  if (value === 'NONE') return 'locked';
  return 'pending';
}

export default function StravaActivityMatchTable() {
  const searchParams = useSearchParams();
  const selectedPlanId = searchParams.get('plan') || '';
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
    }
    try {
      const reviewUrl = new URL(`/api/integrations/strava/review?ts=${Date.now()}`, window.location.origin);
      if (selectedPlanId) reviewUrl.searchParams.set('plan', selectedPlanId);
      const res = await fetch(reviewUrl.toString(), { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body?.error || 'Failed to load Strava table');
        return;
      }
      setData(body as ReviewResponse);
      const selectedPlanIdFromResponse = typeof body?.plan?.id === 'string' ? body.plan.id : '';
      if (selectedPlanIdFromResponse) {
        document.cookie = `${SELECTED_PLAN_COOKIE}=${encodeURIComponent(selectedPlanIdFromResponse)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }
    } catch {
      setStatus('Failed to load Strava table');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshTable() {
    await load();
  }

  async function syncRecent() {
    setSyncing(true);
    setStatus('Syncing Strava from plan start to today...');
    try {
      const res = await fetch('/api/integrations/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncFromPlanStart: true, planId: selectedPlanId || undefined })
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
      await load({ silent: true });
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
        body: JSON.stringify({ date, planId: selectedPlanId || undefined })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body?.error || 'Import failed');
        return;
      }
      const summary = body?.summary || {};
      const matchedCount = Number(summary.matched ?? 0);
      const totalCount = Number(summary.stravaActivities ?? 0);
      if (totalCount === 0) {
        setStatus(`Imported ${summary.date}: no Strava activities found for this date.`);
      } else if (summary.restDayAutoCompleted) {
        setStatus(`Imported ${summary.date}: rest day — Strava activity found, day marked done ✓`);
      } else if (matchedCount === 0) {
        setStatus(`Imported ${summary.date}: found ${totalCount} Strava activities, but no plan matches were applied.`);
      } else {
        setStatus(
          `Imported ${summary.date}: ${totalCount} Strava activities, ${matchedCount} matched, ${summary.workoutsUpdated ?? 0} workout logs updated`
        );
      }
      await load({ silent: true });
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
                const matchedStravaCount = day.stravaActivities.filter((activity) => Boolean(activity.matchedPlanActivityId)).length;
                const matchedPlanCount = day.planActivities.filter((activity) => Boolean(activity.matchedExternalActivityId)).length;
                const completedPlanCount = day.planActivities.filter((activity) => activity.completed).length;
                const dayDone = hasStrava && matchedStravaCount > 0 && matchedStravaCount === day.stravaActivities.length;
                const dayPartial = hasStrava && matchedStravaCount > 0 && matchedStravaCount < day.stravaActivities.length;
                const actionLabel = dayLocked ? 'Locked' : dayDone ? 'Done' : dayPartial ? 'Re-import' : 'Import';
                const rowClickable = hasStrava && !dayLocked && !dayDone && !importing;
                return (
                  <tr
                    key={day.date}
                    className={`${dayLocked ? 'day-status-locked' : dayDone ? 'day-status-done' : dayPartial ? 'day-status-partial' : ''}${rowClickable ? ' day-row-clickable' : ''}`.trim()}
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
                                <ExternalSportIcon
                                  provider="STRAVA"
                                  sportType={activity.sportType}
                                />
                                {activity.name}
                              </strong>
                              <span>{formatStravaSportType(activity.sportType)}</span>
                              {formatStravaActivity(activity, viewerUnits) && <em>{formatStravaActivity(activity, viewerUnits)}</em>}
                              {activity.matchedPlanActivityId && (
                                <span className={`dash-day-status-chip ${equivalenceClass(resolveEquivalence(activity))}`}>
                                  {equivalenceLabel(resolveEquivalence(activity))}
                                </span>
                              )}
                              {activity.equivalenceNote && (
                                <em>{activity.equivalenceNote}</em>
                              )}
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
                          <span className={`dash-day-status-chip ${dayLocked ? 'locked' : dayDone ? 'done' : dayPartial ? 'partial' : 'pending'}`}>
                            {dayLocked ? 'Locked' : dayDone ? 'Done' : dayPartial ? 'Partial match' : 'Pending import'}
                          </span>
                          <span className="dash-day-action-meta">
                            {dayLocked
                              ? 'Completed day. Import and matching are disabled.'
                              : `${matchedStravaCount}/${day.stravaActivities.length} matched · ${completedPlanCount}/${day.planActivities.length} done`}
                          </span>
                          <button
                            className="dash-sync-btn"
                            type="button"
                            disabled={dayLocked || importing || dayDone}
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
