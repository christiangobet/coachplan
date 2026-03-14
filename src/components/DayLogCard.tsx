'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { buildStravaRoutePreview, type StravaRoutePreview } from '@/lib/strava-route';
import RouteMap from '@/components/RouteMap';
import SessionFlowStrip from '@/components/SessionFlowStrip';
import ExternalSportIcon from '@/components/ExternalSportIcon';
import StravaIcon from '@/components/StravaIcon';

// ── Types ────────────────────────────────────────────────────────────────────

type SyncTone = 'info' | 'success' | 'warning' | 'error';

type StravaImportSummary = {
  date: string;
  stravaActivities: number;
  matched: number;
  workoutsUpdated: number;
  unmatched: number;
  decisions?: StravaSyncDecision[];
  restDayAutoCompleted?: boolean;
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

type SyncedStravaActivity = {
  id: string;
  name: string;
  sportType: string | null;
  startTime: string | null;
  distanceM: number | null;
  movingTimeSec: number | null;
  durationSec: number | null;
  elevationGainM: number | null;
  raw?: unknown;
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
  if (summary.restDayAutoCompleted) return 'Rest day — Strava activity found, day marked done ✓';
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

function buildPlannedSummary(activity: LogActivity): string | null {
  if (!Array.isArray(activity.plannedDetails) || activity.plannedDetails.length === 0) return null;
  return activity.plannedDetails.join(' · ');
}

function trimUnitFromValue(value: string, unit: string) {
  if (!unit) return value;
  if (value.endsWith(` ${unit}`)) return value.slice(0, -(unit.length + 1));
  if (value.endsWith(unit)) return value.slice(0, -unit.length);
  return value;
}

function buildDistanceProgressLabel(planned: string | null, logged: string | null, unit?: string) {
  if (planned && logged) {
    const plannedCompact = unit ? trimUnitFromValue(planned, unit) : planned;
    return `${plannedCompact} \u2192 ${logged}`;
  }
  if (logged) return logged;
  if (planned) return planned;
  return null;
}

function formatDistanceOneDecimal(value: number) {
  return value.toFixed(1);
}

function distanceProgressTone(planned: string | null, logged: string | null) {
  if (planned && logged) return 'mix';
  if (logged) return 'logged';
  return 'planned';
}

function buildRunDistanceProgress(activity: LogActivity, viewerUnits: DistanceUnit) {
  if (activity.type !== 'RUN') return null;
  const unit = distanceUnitLabel(viewerUnits);
  const planned = activity.plannedDistance != null ? `${formatDistanceOneDecimal(activity.plannedDistance)} ${unit}` : null;
  const logged = activity.actualDistance != null ? `${formatDistanceOneDecimal(activity.actualDistance)} ${unit}` : null;
  const text = buildDistanceProgressLabel(planned, logged, unit);
  if (!text) return null;
  return {
    text,
    tone: distanceProgressTone(planned, logged)
  };
}

function buildEffectiveActualSummary(activity: LogActivity): string | null {
  if (activity.type !== 'RUN') return null;
  if (activity.actualDistance == null && activity.actualDuration == null && !activity.actualPace) return null;
  const parts: string[] = [];
  // Distance is shown in the compact planned/logged pill.
  if (activity.actualDuration != null) {
    parts.push(`${activity.actualDuration} min`);
  }
  if (activity.actualPace) {
    parts.push(activity.actualPace);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function resolveInstructionText(activity: LogActivity): string | null {
  if (typeof activity.sessionInstructions === 'string' && activity.sessionInstructions.trim()) {
    return activity.sessionInstructions.trim();
  }
  if (typeof activity.plannedNotes === 'string' && activity.plannedNotes.trim()) {
    return activity.plannedNotes.trim();
  }
  return null;
}

function formatSyncedStravaDuration(value: number | null | undefined) {
  if (!value || value <= 0) return '—';
  return `${Math.round(value / 60)} min`;
}

function formatSyncedStravaDistance(
  value: number | null | undefined,
  viewerUnits: DistanceUnit
) {
  if (!value || value <= 0) return '—';
  const converted = convertDistanceForDisplay(value / 1000, 'KM', viewerUnits);
  if (!converted) return '—';
  return `${formatDistanceNumber(converted.value)} ${distanceUnitLabel(converted.unit)}`;
}

function buildSyncedActivityRoutePreview(activity: SyncedStravaActivity): StravaRoutePreview | null {
  return buildStravaRoutePreview({
    name: activity.name,
    sportType: activity.sportType,
    startTime: activity.startTime || new Date().toISOString(),
    distanceM: activity.distanceM,
    movingTimeSec: activity.movingTimeSec ?? activity.durationSec,
    elevationGainM: activity.elevationGainM,
    raw: activity.raw,
  });
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

  const plannedDistanceHint = convertDistanceForDisplay(
    activity.plannedDistance,
    viewerUnits,
    viewerUnits
  );
  const distUnit = distanceUnitLabel(viewerUnits);
  const hasPrefilledActuals =
    activity.type === 'RUN'
    && (form.distancePrefilled || form.durationPrefilled)
    && (Boolean(form.actualDistance.trim()) || Boolean(form.actualDuration.trim()));
  const prefilledSummary = hasPrefilledActuals
    ? [form.actualDistance.trim() ? `${form.actualDistance.trim()} ${distUnit}` : null, form.actualDuration.trim() ? `${form.actualDuration.trim()} min` : null]
      .filter((part): part is string => Boolean(part))
      .join(' · ')
    : null;

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
      {prefilledSummary && (
        <p className="dash-log-sync-note success day-log-effective-callout">
          Effective logged (Strava): {prefilledSummary}
        </p>
      )}
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
  planView = false,
  showSyncedStravaSection = true,
  syncedStravaActivities = null,
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
  /** Plan-edit mode: show instructions only, hide all log forms and status buttons */
  planView?: boolean;
  showSyncedStravaSection?: boolean;
  syncedStravaActivities?: SyncedStravaActivity[] | null;
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
  const [syncedActivities, setSyncedActivities] = useState<SyncedStravaActivity[]>(() =>
    Array.isArray(syncedStravaActivities) ? syncedStravaActivities : []
  );
  const [syncedActivitiesBusy, setSyncedActivitiesBusy] = useState(false);
  const [syncedActivitiesError, setSyncedActivitiesError] = useState<string | null>(null);

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

  const paceAutofillSignature = useMemo(
    () =>
      activities
        .map((activity) => {
          const f = forms[activity.id];
          return `${activity.id}:${f?.actualDistance ?? ''}:${f?.actualDuration ?? ''}:${f?.paceUserEdited ?? ''}`;
        })
        .join('|'),
    [activities, forms]
  );

  // Sync initialDayStatus/missedReason when props change
  useEffect(() => { setDayStatus(initialDayStatus); }, [initialDayStatus]);
  useEffect(() => { setMissedReason(initialMissedReason || ''); }, [initialMissedReason]);
  useEffect(() => { setSyncDecisions([]); }, [dateISO, planId]);
  useEffect(() => {
    if (!Array.isArray(syncedStravaActivities)) return;
    setSyncedActivities(syncedStravaActivities);
    setSyncedActivitiesError(null);
    setSyncedActivitiesBusy(false);
  }, [syncedStravaActivities]);

  const primaryRoutePreview: StravaRoutePreview | null = useMemo(() => {
    for (const activity of syncedActivities) {
      const preview = buildSyncedActivityRoutePreview(activity);
      if (preview) return preview;
    }
    return null;
  }, [syncedActivities]);

  const loadSyncedActivities = useCallback(async () => {
    if (!showSyncedStravaSection || Array.isArray(syncedStravaActivities)) return;
    if (!dateISO || !planId) {
      setSyncedActivities([]);
      return;
    }
    setSyncedActivitiesBusy(true);
    setSyncedActivitiesError(null);
    try {
      const res = await fetch(`/api/integrations/strava/review?plan=${encodeURIComponent(planId)}`, {
        cache: 'no-store'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || 'Failed to load synced Strava activities');
      }
      const matchingDay = Array.isArray(body?.days)
        ? body.days.find((day: any) => day?.date === dateISO)
        : null;
      const nextActivities = Array.isArray(matchingDay?.stravaActivities)
        ? matchingDay.stravaActivities
          .map((activity: any) => ({
            id: String(activity?.id || ''),
            name: typeof activity?.name === 'string' && activity.name.trim().length > 0
              ? activity.name
              : (typeof activity?.sportType === 'string' ? activity.sportType.replace(/_/g, ' ') : 'Strava activity'),
            sportType: typeof activity?.sportType === 'string' ? activity.sportType : null,
            startTime: typeof activity?.startTime === 'string' ? activity.startTime : null,
            distanceM: typeof activity?.distanceM === 'number' ? activity.distanceM : null,
            movingTimeSec: typeof activity?.movingTimeSec === 'number' ? activity.movingTimeSec : null,
            durationSec: typeof activity?.durationSec === 'number' ? activity.durationSec : null,
            elevationGainM: typeof activity?.elevationGainM === 'number' ? activity.elevationGainM : null,
            raw: activity?.raw
          }))
          .filter((activity: SyncedStravaActivity) => activity.id.length > 0)
        : [];
      setSyncedActivities(nextActivities);
    } catch (error: any) {
      setSyncedActivities([]);
      setSyncedActivitiesError(error?.message || 'Unable to load synced Strava activities');
    } finally {
      setSyncedActivitiesBusy(false);
    }
  }, [dateISO, planId, showSyncedStravaSection, syncedStravaActivities]);

  useEffect(() => {
    void loadSyncedActivities();
  }, [loadSyncedActivities]);

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
  }, [activities, viewerUnits]);

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
  }, [activities, paceAutofillSignature, viewerUnits]);

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
      await loadSyncedActivities();
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
    <div className="day-log-card" data-debug-id="DLC">

      {/* Day status row */}
      {dayId && enabled && !planView && (
        <div className="day-log-status-bar">
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

      {/* Strava sync */}
      {enabled && !isClosed && !planView && (
        <div className="day-log-strava-bar">
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

      {/* Sync results */}
      {(syncMessage || syncDecisions.length > 0) && (
        <div className="day-log-sync-area">
          {syncMessage && (
            <p className={`dash-log-sync-note ${syncTone}`}>{syncMessage}</p>
          )}
          {syncDecisions.length > 0 && (
            <div className="day-log-decisions">
              {syncDecisions.map((decision) => {
                const effective = resolveDecisionEquivalence(decision);
                return (
                  <div key={decision.externalActivityId} className="day-log-decision">
                    <p className={`dash-log-sync-note ${equivalenceTone(effective)}`}>
                      {equivalenceCopy(effective)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Synced Strava activities */}
      {showSyncedStravaSection && (
        <div className="day-log-synced-section">
          <div className="day-log-synced-head">
            <StravaIcon size={13} />
            <h4>Synced Strava activities</h4>
          </div>
          {syncedActivitiesBusy ? (
            <p className="day-log-synced-empty">Loading synced activities…</p>
          ) : syncedActivitiesError ? (
            <p className="day-log-synced-empty">{syncedActivitiesError}</p>
          ) : syncedActivities.length === 0 ? (
            <p className="day-log-synced-empty">No synced Strava activities for this day.</p>
          ) : (
            <div className="day-log-synced-list">
              {syncedActivities.map((activity) => (
                <div key={activity.id} className="day-log-synced-item">
                  <div className="day-log-synced-item-title">
                    <ExternalSportIcon
                      provider="STRAVA"
                      sportType={activity.sportType}
                      className="day-log-synced-item-icon"
                    />
                    <span>{activity.name}</span>
                  </div>
                  <div className="day-log-synced-item-meta">
                    <span>
                      {formatSyncedStravaDistance(activity.distanceM, viewerUnits)} · {formatSyncedStravaDuration(activity.durationSec)}
                    </span>
                    {activity.startTime && (
                      <span>
                        {new Date(activity.startTime).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {primaryRoutePreview ? (
            <section className="day-log-inline-route" aria-label="Strava route preview">
              <div className="day-log-inline-route-head">
                <div>
                  <span className="day-log-inline-route-kicker">Route</span>
                  <h5>{primaryRoutePreview.name || 'Workout route'}</h5>
                </div>
                <span className="day-log-inline-route-meta">Imported from Strava</span>
              </div>
              <div className="day-log-inline-route-map">
                <RouteMap
                  routePoints={primaryRoutePreview.routePoints}
                  ariaLabel={primaryRoutePreview.name ? `${primaryRoutePreview.name} route preview` : 'Route preview'}
                />
              </div>
            </section>
          ) : null}
        </div>
      )}

      {/* Per-activity forms — grouped by sessionGroupId */}
      {(() => {
        // Build display list: standalone activities or session groups (in original order)
        type SessionGroup = { sessionGroupId: string; members: LogActivity[] };
        type DisplayItem = { kind: 'standalone'; activity: LogActivity } | { kind: 'session'; group: SessionGroup };
        const displayItems: DisplayItem[] = [];
        const seenGroups = new Map<string, SessionGroup>();

        for (const activity of activities) {
          if (!activity.sessionGroupId) {
            displayItems.push({ kind: 'standalone', activity });
          } else {
            let group = seenGroups.get(activity.sessionGroupId);
            if (!group) {
              group = { sessionGroupId: activity.sessionGroupId, members: [] };
              seenGroups.set(activity.sessionGroupId, group);
              displayItems.push({ kind: 'session', group });
            }
            // Insert sorted by sessionOrder
            const insertAt = activity.sessionOrder != null
              ? group.members.findIndex((m) => (m.sessionOrder ?? 0) > (activity.sessionOrder ?? 0))
              : -1;
            if (insertAt === -1) group.members.push(activity);
            else group.members.splice(insertAt, 0, activity);
          }
        }

        return displayItems.map((item, idx) => {
          if (item.kind === 'standalone') {
            const activity = item.activity;
            const instructionText = resolveInstructionText(activity);
            const f = forms[activity.id] ?? {
              actualDistance: '', actualDuration: '', actualPace: '',
              distancePrefilled: false, durationPrefilled: false,
              pacePrefilled: false, paceUserEdited: false,
              busy: false, error: null, savedStatus: null,
            };
            const showForm = enabled && !isClosed && !activity.completed;
            const plannedSummary = buildPlannedSummary(activity);
            const runDistanceProgress = buildRunDistanceProgress(activity, viewerUnits);
            const effectiveActualSummary = buildEffectiveActualSummary(activity);
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
                    {plannedSummary && (
                      <span className="cal-activity-metrics">{plannedSummary}</span>
                    )}
                    {runDistanceProgress && (
                      <span className={`cal-activity-distance-progress ${runDistanceProgress.tone}`}>
                        {runDistanceProgress.text}
                      </span>
                    )}
                    {effectiveActualSummary && (
                      <span className="cal-activity-effective-distance">{effectiveActualSummary}</span>
                    )}
                  </div>
                </div>
                <SessionFlowStrip
                  structure={activity.structure}
                  size="compact"
                  className="day-log-session-flow"
                />
                {instructionText && (
                  <details className="day-log-instructions" open>
                    <summary className="day-log-instructions-toggle">How to execute</summary>
                    <p className="day-log-instructions-text">{instructionText}</p>
                  </details>
                )}
                {showForm && !planView && (
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
          }

          // Session group
          const { members } = item.group;
          const totalPlannedDist = members.reduce((s, m) => s + (m.plannedDistance ?? 0), 0);
          const totalPlannedDur = members.reduce((s, m) => s + (m.plannedDuration ?? 0), 0);
          const anyLogged = members.some((m) => m.actualDistance != null || m.actualDuration != null);
          const totalActualDist = anyLogged
            ? members.reduce((s, m) => s + (m.actualDistance ?? 0), 0)
            : null;
          const totalActualDur = anyLogged
            ? members.reduce((s, m) => s + (m.actualDuration ?? 0), 0)
            : null;
          const distUnit = distanceUnitLabel(viewerUnits);
          const plannedDistText = totalPlannedDist > 0 ? `${formatDistanceOneDecimal(totalPlannedDist)} ${distUnit}` : null;
          const loggedDistText = totalActualDist != null ? `${formatDistanceOneDecimal(totalActualDist)} ${distUnit}` : null;
          const distanceProgress = buildDistanceProgressLabel(plannedDistText, loggedDistText, distUnit);
          const durationProgress = buildDistanceProgressLabel(
            totalPlannedDur > 0 ? `~${totalPlannedDur} min` : null,
            totalActualDur != null ? `${totalActualDur} min` : null
          );

          return (
            <details key={`session-${item.group.sessionGroupId}-${idx}`} className="cal-session-group">
              <summary className="cal-session-group-header">
                <span className="cal-session-group-label">Session</span>
                {(distanceProgress || durationProgress) && (
                  <span className="cal-session-group-meta">
                    <span className="cal-session-group-planned">
                      {distanceProgress || ''}
                      {distanceProgress && durationProgress ? ' · ' : ''}
                      {durationProgress || ''}
                    </span>
                  </span>
                )}
              </summary>
              <div className="cal-session-group-members">
                {members.map((activity, mIdx) => {
                  const instructionText = resolveInstructionText(activity);
                  const f = forms[activity.id] ?? {
                    actualDistance: '', actualDuration: '', actualPace: '',
                    distancePrefilled: false, durationPrefilled: false,
                    pacePrefilled: false, paceUserEdited: false,
                    busy: false, error: null, savedStatus: null,
                  };
                  const showForm = enabled && !isClosed && !activity.completed;
                  const isLast = mIdx === members.length - 1;
                  const plannedSummary = buildPlannedSummary(activity);
                  const runDistanceProgress = buildRunDistanceProgress(activity, viewerUnits);
                  const effectiveActualSummary = buildEffectiveActualSummary(activity);
                  return (
                    <div key={activity.id} className={`cal-activity-section cal-session-member${isLast ? ' cal-session-member--last' : ''}`}>
                      <div className="cal-activity-workout-row">
                        <span className={`dash-type-badge dash-type-${String(activity.type || 'OTHER').toLowerCase()}`}>
                          {typeAbbr(activity.type)}
                        </span>
                        <div className="cal-activity-workout-info">
                          <span className="cal-activity-title">
                            {activity.title || activity.type}
                            {activity.completed && <span className="cal-activity-done-chip">✓</span>}
                          </span>
                          {plannedSummary && (
                            <span className="cal-activity-metrics">{plannedSummary}</span>
                          )}
                          {runDistanceProgress && (
                            <span className={`cal-activity-distance-progress ${runDistanceProgress.tone}`}>
                              {runDistanceProgress.text}
                            </span>
                          )}
                          {effectiveActualSummary && (
                            <span className="cal-activity-effective-distance">{effectiveActualSummary}</span>
                          )}
                        </div>
                      </div>
                      <SessionFlowStrip
                        structure={activity.structure}
                        size="compact"
                        className="day-log-session-flow"
                      />
                      {instructionText && (
                        <details className="day-log-instructions" open>
                          <summary className="day-log-instructions-toggle">How to execute</summary>
                          <p className="day-log-instructions-text">{instructionText}</p>
                        </details>
                      )}
                      {showForm && !planView && (
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
            </details>
          );
        });
      })()}
    </div>
  );
}
