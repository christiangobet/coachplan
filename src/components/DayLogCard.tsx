'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DayStatus } from '@/lib/day-status';
import type { LogActivity } from '@/lib/log-activity';
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  resolveDistanceUnitFromActivity,
  type DistanceUnit,
} from '@/lib/unit-display';

// ── Types ────────────────────────────────────────────────────────────────────

type SyncTone = 'info' | 'success' | 'warning' | 'error';

type StravaImportSummary = {
  date: string;
  stravaActivities: number;
  matched: number;
  workoutsUpdated: number;
  unmatched: number;
  decisions?: StravaSyncDecision[];
};

type StravaSyncDecision = {
  externalActivityId: string;
  externalName: string | null;
  sportType: string | null;
  planActivityId: string | null;
  planActivityTitle: string | null;
  equivalence: 'FULL' | 'PARTIAL' | 'NONE' | null;
  equivalenceOverride: 'FULL' | 'PARTIAL' | 'NONE' | null;
  loadRatio: number | null;
  equivalenceConfidence: number | null;
  equivalenceNote: string | null;
};

type ActivityFormState = {
  actualDistance: string;
  actualDuration: string;
  actualPace: string;
  distancePrefilled: boolean;
  durationPrefilled: boolean;
  pacePrefilled: boolean;
  paceUserEdited: boolean;
  busy: boolean;
  error: string | null;
  savedStatus: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toFieldValue(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseNumericOrNull(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
  return parsed;
}

function summarizeImport(summary: StravaImportSummary) {
  if (summary.stravaActivities === 0) return 'No Strava activities found for this day.';
  const noun = summary.stravaActivities === 1 ? 'activity' : 'activities';
  return `Synced ${summary.stravaActivities} ${noun} · ${summary.matched} matched · ${summary.workoutsUpdated} updated · ${summary.unmatched} unmatched`;
}

function resolveDecisionEquivalence(decision: StravaSyncDecision) {
  return decision.equivalenceOverride || decision.equivalence || null;
}

function equivalenceCopy(value: 'FULL' | 'PARTIAL' | 'NONE' | null) {
  if (value === 'FULL') return 'Counts fully';
  if (value === 'PARTIAL') return 'Counts partially';
  if (value === 'NONE') return 'Does not count';
  return 'Not evaluated';
}

function equivalenceTone(value: 'FULL' | 'PARTIAL' | 'NONE' | null): SyncTone {
  if (value === 'FULL') return 'success';
  if (value === 'PARTIAL') return 'warning';
  return 'error';
}

const TYPE_ABBR: Record<string, string> = {
  RUN: 'RUN', STRENGTH: 'STR', CROSS_TRAIN: 'XT',
  REST: 'RST', MOBILITY: 'MOB', YOGA: 'YOG', HIKE: 'HIK', OTHER: 'OTH',
};
function typeAbbr(type: string) {
  return TYPE_ABBR[String(type || 'OTHER').toUpperCase()] || 'OTH';
}

// ── ActivityRow ───────────────────────────────────────────────────────────────

function ActivityRow({
  activity,
  viewerUnits,
  enabled,
  form,
  onChange,
  onSubmit,
}: {
  activity: LogActivity;
  viewerUnits: DistanceUnit;
  enabled: boolean;
  form: ActivityFormState;
  onChange: (patch: Partial<ActivityFormState>) => void;
  onSubmit: () => void;
}) {
  const isRestDay = activity.type === 'REST';

  const plannedSourceUnit =
    resolveDistanceUnitFromActivity({
      distanceUnit: activity.distanceUnit,
      paceTarget: activity.paceTarget,
      actualPace: activity.actualPace,
      fallbackUnit: viewerUnits,
    }) || viewerUnits;

  const plannedDistanceHint = convertDistanceForDisplay(
    activity.plannedDistance,
    viewerUnits,
    viewerUnits
  );
  const distUnit = distanceUnitLabel(viewerUnits);

  if (!enabled) {
    return (
      <p className="cal-activity-log-disabled">Manual logging opens on activity day.</p>
    );
  }

  if (isRestDay) {
    return (
      <div className="dash-log-section cal-activity-log">
        <p className="cal-activity-log-hint">Rest day · only completion status is needed.</p>
        {form.error && <p className="dash-log-error">{form.error}</p>}
        {form.savedStatus && <p className="dash-log-sync-note success">{form.savedStatus}</p>}
        <div className="dash-log-actions">
          <button
            type="button"
            className="dash-btn-primary"
            onClick={onSubmit}
            disabled={form.busy}
          >
            {form.busy ? 'Saving…' : activity.completed ? 'Update status' : 'Mark rest day done'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-log-section cal-activity-log">
      <div className="dash-log-fields">
        <label className="dash-log-field">
          <span>Distance ({distUnit})</span>
          <input
            type="text"
            inputMode="decimal"
            value={form.actualDistance}
            onChange={(e) => onChange({ actualDistance: e.target.value, distancePrefilled: false })}
            placeholder={plannedDistanceHint ? formatDistanceNumber(plannedDistanceHint.value) : 'e.g. 8'}
            className={form.distancePrefilled ? 'is-prefilled' : undefined}
          />
        </label>
        <label className="dash-log-field">
          <span>Duration (min)</span>
          <input
            type="text"
            inputMode="numeric"
            value={form.actualDuration}
            onChange={(e) => onChange({ actualDuration: e.target.value, durationPrefilled: false })}
            placeholder={activity.plannedDuration ? String(activity.plannedDuration) : 'e.g. 45'}
            className={form.durationPrefilled ? 'is-prefilled' : undefined}
          />
        </label>
        {activity.type === 'RUN' && (
          <label className="dash-log-field">
            <span>Pace</span>
            <input
              type="text"
              value={form.actualPace}
              onChange={(e) => onChange({ actualPace: e.target.value, pacePrefilled: false, paceUserEdited: true })}
              placeholder={viewerUnits === 'KM' ? 'e.g. 4:40 /km' : 'e.g. 7:30 /mi'}
              className={form.pacePrefilled ? 'is-prefilled' : undefined}
            />
          </label>
        )}
      </div>
      {form.error && <p className="dash-log-error">{form.error}</p>}
      {form.savedStatus && <p className="dash-log-sync-note success">{form.savedStatus}</p>}
      <div className="dash-log-actions">
        <button
          type="button"
          className="dash-btn-primary"
          onClick={onSubmit}
          disabled={form.busy}
        >
          {form.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── DayLogCard ────────────────────────────────────────────────────────────────

export default function DayLogCard({
  dayId,
  dateISO,
  planId,
  activities,
  viewerUnits,
  dayStatus: initialDayStatus,
  missedReason: initialMissedReason,
  stravaConnected,
  enabled,
  onClose,
  successRedirectHref = null,
}: {
  dayId: string | null;
  dateISO: string;
  planId: string;
  activities: LogActivity[];
  viewerUnits: DistanceUnit;
  dayStatus: DayStatus;
  missedReason?: string | null;
  stravaConnected: boolean;
  enabled: boolean;
  onClose?: () => void;
  successRedirectHref?: string | null;
}) {
  const router = useRouter();

  // Day-level state
  const [dayStatus, setDayStatus] = useState<DayStatus>(initialDayStatus);
  const [missedReason, setMissedReason] = useState(initialMissedReason || '');
  const [dayBusy, setDayBusy] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [showAdapt, setShowAdapt] = useState(false);
  const [adaptContext, setAdaptContext] = useState<'missed' | 'below_plan'>('missed');
  const [adaptDistance, setAdaptDistance] = useState('');

  // Strava sync state
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncTone, setSyncTone] = useState<SyncTone>('info');
  const [syncDecisions, setSyncDecisions] = useState<StravaSyncDecision[]>([]);

  // Per-activity form state
  const [forms, setForms] = useState<Record<string, ActivityFormState>>(() => {
    const init: Record<string, ActivityFormState> = {};
    for (const a of activities) {
      init[a.id] = {
        actualDistance: '', actualDuration: '', actualPace: '',
        distancePrefilled: false, durationPrefilled: false,
        pacePrefilled: false, paceUserEdited: false,
        busy: false, error: null, savedStatus: null,
      };
    }
    return init;
  });

  // Sync initialDayStatus/missedReason when props change
  useEffect(() => { setDayStatus(initialDayStatus); }, [initialDayStatus]);
  useEffect(() => { setMissedReason(initialMissedReason || ''); }, [initialMissedReason]);
  useEffect(() => { setSyncDecisions([]); }, [dateISO, planId]);

  // Prefill each activity form from actuals
  useEffect(() => {
    setForms((prev) => {
      const next = { ...prev };
      for (const activity of activities) {
        const actualSourceUnit =
          resolveDistanceUnitFromActivity({
            distanceUnit: activity.distanceUnit,
            paceTarget: activity.paceTarget,
            actualPace: activity.actualPace,
            fallbackUnit: viewerUnits,
            preferActualPace: true,
          }) || viewerUnits;

        const convertedDistance = convertDistanceForDisplay(
          activity.actualDistance,
          actualSourceUnit,
          viewerUnits
        );
        const distVal = toFieldValue(convertedDistance?.value ?? null);
        const durVal = toFieldValue(activity.actualDuration);
        const paceVal =
          convertPaceForDisplay(activity.actualPace, viewerUnits, actualSourceUnit) || '';

        next[activity.id] = {
          ...(prev[activity.id] ?? {
            busy: false, error: null, savedStatus: null,
          }),
          actualDistance: distVal,
          actualDuration: durVal,
          actualPace: paceVal,
          distancePrefilled: distVal !== '',
          durationPrefilled: durVal !== '',
          pacePrefilled: paceVal !== '',
          paceUserEdited: false,
        };
      }
      return next;
    });
  }, [
    activities.map((a) => `${a.id}:${a.actualDistance}:${a.actualDuration}:${a.actualPace}`).join('|'),
    viewerUnits,
  ]);

  // Pace auto-calc for RUN activities
  useEffect(() => {
    setForms((prev) => {
      const next = { ...prev };
      for (const activity of activities) {
        if (activity.type !== 'RUN') continue;
        const f = next[activity.id];
        if (!f || f.paceUserEdited) continue;
        const dist = parseFloat(f.actualDistance);
        const dur = parseFloat(f.actualDuration);
        if (!isFinite(dist) || dist <= 0 || !isFinite(dur) || dur <= 0) continue;
        const paceDecimal = dur / dist;
        const minutes = Math.floor(paceDecimal);
        const seconds = Math.round((paceDecimal - minutes) * 60);
        const unitSuffix = viewerUnits === 'KM' ? '/km' : '/mi';
        next[activity.id] = {
          ...f,
          actualPace: `${minutes}:${String(seconds).padStart(2, '0')} ${unitSuffix}`,
          pacePrefilled: false,
        };
      }
      return next;
    });
  }, [
    activities.map((a) => {
      const f = forms[a.id];
      return `${a.id}:${f?.actualDistance}:${f?.actualDuration}:${f?.paceUserEdited}`;
    }).join('|'),
  ]);

  function patchForm(activityId: string, patch: Partial<ActivityFormState>) {
    setForms((prev) => ({
      ...prev,
      [activityId]: { ...prev[activityId], ...patch },
    }));
  }

  async function submitActivity(activity: LogActivity) {
    const f = forms[activity.id];
    if (!f || f.busy) return;

    const parsedDistance = parseNumericOrNull(f.actualDistance);
    const parsedDuration = parseNumericOrNull(f.actualDuration);
    if (Number.isNaN(parsedDistance) || Number.isNaN(parsedDuration)) {
      patchForm(activity.id, { error: 'Enter valid numbers (0 or greater).' });
      return;
    }

    patchForm(activity.id, { busy: true, error: null, savedStatus: null });
    try {
      const payload = {
        actualDistance: parsedDistance,
        actualDuration: parsedDuration,
        actualPace: f.actualPace.trim() || null,
        actualDistanceUnit: viewerUnits,
      };
      const endpoint = activity.completed
        ? `/api/activities/${activity.id}/actuals`
        : `/api/activities/${activity.id}/complete`;
      const method = activity.completed ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchForm(activity.id, { busy: false, error: body?.error || 'Failed to save log' });
        return;
      }

      patchForm(activity.id, {
        busy: false,
        savedStatus: activity.completed ? 'Actuals updated.' : 'Activity completed and logged.',
      });

      if (successRedirectHref) {
        router.replace(successRedirectHref);
        return;
      }
      router.refresh();
    } catch {
      patchForm(activity.id, { busy: false, error: 'Failed to save log' });
    }
  }

  async function syncFromStrava() {
    if (syncBusy) return;
    if (!stravaConnected) {
      setSyncTone('warning');
      setSyncMessage('Connect Strava first to auto-match this day. You can still log manually below.');
      return;
    }
    setSyncBusy(true);
    setSyncTone('info');
    setSyncMessage(null);
    try {
      const res = await fetch('/api/integrations/strava/import-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateISO, planId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncTone('error');
        setSyncMessage(body?.error || 'Failed to sync Strava day log');
        setSyncDecisions([]);
        return;
      }
      const summary = body?.summary as StravaImportSummary | undefined;
      setSyncTone(summary && summary.stravaActivities === 0 ? 'warning' : 'success');
      setSyncMessage(summary ? summarizeImport(summary) : 'Strava sync complete.');
      setSyncDecisions(Array.isArray(summary?.decisions) ? summary?.decisions : []);
      router.refresh();
    } catch {
      setSyncTone('error');
      setSyncMessage('Failed to sync Strava day log');
      setSyncDecisions([]);
    } finally {
      setSyncBusy(false);
    }
  }


  async function saveDayStatus(nextStatus: DayStatus) {
    if (!dayId || dayBusy) return;
    setDayBusy(true);
    setDayError(null);
    try {
      const res = await fetch(`/api/plan-days/${dayId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          reason: nextStatus === 'MISSED' ? missedReason : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDayError(data?.error || 'Failed to update day status');
        return;
      }
      const status = (data?.day?.status as DayStatus) || nextStatus;
      setDayStatus(status);
      setMissedReason(typeof data?.day?.reason === 'string' ? data.day.reason : '');

      const today = new Date().toISOString().split('T')[0];
      const isPastDay = dateISO < today;

      if (nextStatus === 'MISSED' && !isPastDay) {
        setAdaptContext('missed');
        setShowAdapt(true);
      } else if (nextStatus === 'DONE') {
        // Check if any primary activity was below plan
        const primary = activities.find((a) => a.type !== 'REST') ?? activities[0];
        const f = primary ? forms[primary.id] : null;
        const distNum = f ? parseFloat(f.actualDistance) : NaN;
        const planned = primary?.plannedDistance;
        if (planned && isFinite(distNum) && distNum < planned * 0.7) {
          setAdaptContext('below_plan');
          setAdaptDistance(f?.actualDistance || '');
          setShowAdapt(true);
        }
      }

      if (nextStatus === 'OPEN') {
        router.refresh();
        return;
      }
      if (successRedirectHref) {
        router.replace(successRedirectHref);
        return;
      }
      if (onClose) {
        onClose();
        return;
      }
      router.refresh();
    } catch {
      setDayError('Failed to update day status');
    } finally {
      setDayBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (showAdapt) {
    const primary = activities.find((a) => a.type !== 'REST') ?? activities[0];
    const distUnit = viewerUnits === 'KM' ? 'km' : 'mi';
    const adaptPrompt =
      adaptContext === 'missed'
        ? "I missed today's workout. Help me rebalance the upcoming week."
        : `My ${primary?.title ?? 'workout'} was ${adaptDistance}${distUnit} vs planned ${primary?.plannedDistance ?? '?'}${distUnit}. Suggest adjustments.`;

    return (
      <div className="dash-log-section dash-adapt-prompt">
        <p className="dash-adapt-message">
          {adaptContext === 'missed'
            ? "You missed today's workout. Want to rebalance the upcoming week?"
            : `You logged ${adaptDistance}${distUnit} vs ${primary?.plannedDistance ?? '?'}${distUnit} planned. Want to adjust?`}
        </p>
        <div className="dash-adapt-actions">
          <a
            className="dash-btn-primary"
            href={`/plans/${planId}?aiPrompt=${encodeURIComponent(adaptPrompt)}&aiSource=dashboard#ai-trainer`}
          >
            Adapt upcoming week →
          </a>
          <button type="button" className="dash-btn-ghost" onClick={() => setShowAdapt(false)}>
            All good
          </button>
        </div>
      </div>
    );
  }

  const isDone = dayStatus === 'DONE';
  const isMissed = dayStatus === 'MISSED';
  const isPartial = dayStatus === 'PARTIAL';
  const isClosed = isDone || isMissed || isPartial;

  return (
    <div className="day-log-card">

      {/* Day status row — sits right below the date header */}
      {dayId && enabled && (
        <div className="cal-day-toggle cal-day-toggle--top">
          <div className="dash-log-actions cal-day-toggle-actions">
            {!isClosed && (
              <div className="cal-day-status-row">
                <button
                  type="button"
                  className="cal-day-status-btn cal-day-status-btn--done"
                  onClick={() => saveDayStatus('DONE')}
                  disabled={dayBusy}
                >
                  <span className="cal-day-status-icon">✓</span>Done
                </button>
                <button
                  type="button"
                  className="cal-day-status-btn cal-day-status-btn--partial"
                  onClick={() => saveDayStatus('PARTIAL')}
                  disabled={dayBusy}
                >
                  <span className="cal-day-status-icon">≈</span>Partial
                </button>
                <button
                  type="button"
                  className="cal-day-status-btn cal-day-status-btn--missed"
                  onClick={() => saveDayStatus('MISSED')}
                  disabled={dayBusy}
                >
                  <span className="cal-day-status-icon">✗</span>Missed
                </button>
              </div>
            )}
            {isMissed && (
              <button
                type="button"
                className="dash-btn-ghost dash-btn-missed"
                onClick={() => saveDayStatus('MISSED')}
                disabled={dayBusy}
              >
                {dayBusy ? 'Saving…' : 'Update Missed Day'}
              </button>
            )}
            {isClosed && (
              <button
                type="button"
                className="dash-btn-ghost"
                onClick={() => saveDayStatus('OPEN')}
                disabled={dayBusy}
              >
                Reopen Day
              </button>
            )}
          </div>
          {isMissed && (
            <textarea
              value={missedReason}
              onChange={(e) => setMissedReason(e.target.value)}
              maxLength={240}
              placeholder="Optional: why this day was missed"
              className="cal-day-missed-reason"
              disabled={dayBusy}
            />
          )}
          {dayError && <p className="dash-log-error">{dayError}</p>}
        </div>
      )}

      {/* Strava sync row */}
      {enabled && !isClosed && (
        <div className="dash-log-header">
          <span className="dash-log-label">Log activities</span>
          <button
            type="button"
            className="dash-log-strava-btn"
            onClick={syncFromStrava}
            disabled={syncBusy}
          >
            {syncBusy ? 'Syncing…' : '↻ Sync from Strava'}
          </button>
        </div>
      )}
      {syncMessage && (
        <p className={`dash-log-sync-note ${syncTone}`}>{syncMessage}</p>
      )}
      {syncDecisions.length > 0 && (
        <div className="dash-log-section" style={{ marginBottom: 12 }}>
          {syncDecisions.map((decision) => {
            const effective = resolveDecisionEquivalence(decision);
            return (
              <div key={decision.externalActivityId} style={{ borderTop: '1px solid var(--d-border-light)', padding: '10px 0' }}>
                <p className={`dash-log-sync-note ${equivalenceTone(effective)}`} style={{ marginBottom: 4 }}>
                  {equivalenceCopy(effective)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Per-activity forms */}
      {activities.map((activity) => {
        const f = forms[activity.id] ?? {
          actualDistance: '', actualDuration: '', actualPace: '',
          distancePrefilled: false, durationPrefilled: false,
          pacePrefilled: false, paceUserEdited: false,
          busy: false, error: null, savedStatus: null,
        };
        const showForm = enabled && !isClosed && (!activity.completed);
        return (
          <div key={activity.id} className="cal-activity-section">
            <div className="cal-activity-workout-row">
              <span className={`dash-type-badge dash-type-${String(activity.type || 'OTHER').toLowerCase()}`}>
                {typeAbbr(activity.type)}
              </span>
              <div className="cal-activity-workout-info">
                <span className="cal-activity-title">
                  {activity.title || activity.type}
                  {activity.completed && <span className="cal-activity-done-chip">✓</span>}
                </span>
                {activity.plannedDetails.length > 0 && (
                  <span className="cal-activity-metrics">{activity.plannedDetails.join(' · ')}</span>
                )}
              </div>
            </div>
            {activity.sessionInstructions && activity.sessionInstructions !== activity.plannedNotes && (
              <details className="day-log-instructions" open>
                <summary className="day-log-instructions-toggle">How to execute</summary>
                <p className="day-log-instructions-text">{activity.sessionInstructions}</p>
              </details>
            )}
            {showForm && (
              <ActivityRow
                activity={activity}
                viewerUnits={viewerUnits}
                enabled={enabled}
                form={f}
                onChange={(patch) => patchForm(activity.id, patch)}
                onSubmit={() => submitActivity(activity)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
