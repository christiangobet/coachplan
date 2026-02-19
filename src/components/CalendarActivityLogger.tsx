'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  convertDistanceForDisplay,
  convertPaceForDisplay,
  distanceUnitLabel,
  type DistanceUnit
} from '@/lib/unit-display';

type CalendarActivityLoggerProps = {
  activity: {
    id: string;
    type: 'RUN' | 'STRENGTH' | 'CROSS_TRAIN' | 'REST' | 'MOBILITY' | 'YOGA' | 'HIKE' | 'OTHER';
    completed: boolean;
    distance: number | null;
    duration: number | null;
    distanceUnit: 'MILES' | 'KM' | null;
    actualDistance: number | null;
    actualDuration: number | null;
    actualPace: string | null;
  };
  viewerUnit: DistanceUnit;
  enabled: boolean;
  successRedirectHref?: string | null;
};

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

export default function CalendarActivityLogger({
  activity,
  viewerUnit,
  enabled,
  successRedirectHref = null
}: CalendarActivityLoggerProps) {
  const router = useRouter();
  const [actualDistance, setActualDistance] = useState('');
  const [actualDuration, setActualDuration] = useState('');
  const [actualPace, setActualPace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const isRestDay = activity.type === 'REST';

  useEffect(() => {
    const convertedDistance = convertDistanceForDisplay(
      activity.actualDistance,
      activity.distanceUnit,
      viewerUnit
    );
    setActualDistance(toFieldValue(convertedDistance?.value ?? null));
    setActualDuration(toFieldValue(activity.actualDuration));
    setActualPace(
      convertPaceForDisplay(activity.actualPace, viewerUnit, activity.distanceUnit || viewerUnit) || ''
    );
    setError(null);
    setStatus(null);
  }, [
    activity.id,
    activity.actualDistance,
    activity.actualDuration,
    activity.actualPace,
    activity.distanceUnit,
    viewerUnit
  ]);

  async function submit() {
    if (!enabled || busy) return;
    const parsedDistance = parseNumericOrNull(actualDistance);
    const parsedDuration = parseNumericOrNull(actualDuration);
    if (Number.isNaN(parsedDistance) || Number.isNaN(parsedDuration)) {
      setError('Enter valid numbers (0 or greater).');
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const payload = {
        actualDistance: parsedDistance,
        actualDuration: parsedDuration,
        actualPace: actualPace.trim() || null,
        actualDistanceUnit: viewerUnit
      };

      const endpoint = activity.completed
        ? `/api/activities/${activity.id}/actuals`
        : `/api/activities/${activity.id}/complete`;
      const method = activity.completed ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Failed to save log');
        return;
      }

      setStatus(activity.completed ? 'Actuals updated.' : 'Activity completed and logged.');
      if (successRedirectHref) {
        router.replace(successRedirectHref);
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to save log');
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <p className="cal-activity-log-disabled">
        Manual logging opens on activity day.
      </p>
    );
  }

  return (
    <div className="cal-activity-log">
      {!isRestDay && (
        <>
          <div className="cal-activity-log-grid">
            <label>
              Distance ({distanceUnitLabel(viewerUnit)})
              <input
                type="text"
                inputMode="decimal"
                value={actualDistance}
                onChange={(event) => setActualDistance(event.target.value)}
                placeholder={activity.distance ? String(activity.distance) : 'e.g. 8'}
              />
            </label>
            <label>
              Duration (min)
              <input
                type="text"
                inputMode="numeric"
                value={actualDuration}
                onChange={(event) => setActualDuration(event.target.value)}
                placeholder={activity.duration ? String(activity.duration) : 'e.g. 45'}
              />
            </label>
          </div>
          <label className="cal-activity-log-pace">
            Pace
            <input
              type="text"
              value={actualPace}
              onChange={(event) => setActualPace(event.target.value)}
              placeholder={viewerUnit === 'KM' ? 'e.g. 4:40 /km' : 'e.g. 7:30 /mi'}
            />
          </label>
        </>
      )}
      {isRestDay && (
        <p className="cal-activity-log-hint">
          Rest day: only completion status is needed.
        </p>
      )}
      <div className="cal-activity-log-actions">
        <button
          type="button"
          className="dash-sync-btn"
          onClick={submit}
          disabled={busy}
        >
          {
            busy
              ? 'Saving...'
              : activity.completed
                ? (isRestDay ? 'Update status' : 'Save actuals')
                : (isRestDay ? 'Mark rest day done' : 'Complete + Save')
          }
        </button>
        {status && <span className="cal-activity-log-status">{status}</span>}
      </div>
      {error && <span className="cal-day-toggle-error">{error}</span>}
    </div>
  );
}
