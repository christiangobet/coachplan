"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type CompleteWorkoutButtonProps = {
  activityId: string;
  completed?: boolean;
  actualDistance?: number | null;
  actualDuration?: number | null;
  actualPace?: string | null;
  plannedDistance?: number | null;
  plannedDuration?: number | null;
  distanceUnit?: string | null;
};

export default function CompleteWorkoutButton({
  activityId,
  completed = false,
  actualDistance = null,
  actualDuration = null,
  actualPace = null,
  plannedDistance = null,
  plannedDuration = null,
  distanceUnit = null
}: CompleteWorkoutButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [pace, setPace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openModal = () => {
    setDistance(actualDistance != null ? String(actualDistance) : '');
    setDuration(actualDuration != null ? String(actualDuration) : '');
    setPace(actualPace || '');
    setError(null);
    setOpen(true);
  };

  const submitActuals = (opts: { complete: boolean }) => {
    setError(null);
    startTransition(async () => {
      const payload = {
        actualDistance: distance.trim(),
        actualDuration: duration.trim(),
        actualPace: pace.trim()
      };

      const url = opts.complete
        ? `/api/activities/${activityId}/complete`
        : `/api/activities/${activityId}/actuals`;
      const method = opts.complete ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Failed to save workout actuals');
        return;
      }

      setOpen(false);
      router.refresh();
    });
  };

  const completeWithoutActuals = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/activities/${activityId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Failed to complete workout');
        return;
      }

      setOpen(false);
      router.refresh();
    });
  };

  const primaryLabel = completed ? 'Update Actuals' : 'Mark as Complete';
  const distanceHint = distanceUnit === 'KM' ? 'km' : 'mi';

  return (
    <>
      <button className="btn-light" type="button" onClick={openModal} disabled={isPending}>
        {isPending ? 'Saving…' : primaryLabel}
      </button>

      {open && (
        <div className="dash-actuals-overlay" onClick={() => setOpen(false)}>
          <div className="dash-actuals-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{completed ? 'Update workout actuals' : 'Complete workout'}</h3>
            <p className="dash-actuals-sub">
              Log what you actually did{completed ? '.' : ', or skip and complete now.'}
            </p>

            <div className="dash-actuals-grid">
              <label>
                Distance ({distanceHint})
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  placeholder={plannedDistance != null ? String(plannedDistance) : 'e.g. 8'}
                />
              </label>
              <label>
                Duration (min)
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder={plannedDuration != null ? String(plannedDuration) : 'e.g. 50'}
                />
              </label>
              <label>
                Pace
                <input
                  type="text"
                  value={pace}
                  onChange={(e) => setPace(e.target.value)}
                  placeholder={`e.g. 7:20 /${distanceHint}`}
                />
              </label>
            </div>

            {error && <p className="dash-actuals-error">{error}</p>}

            <div className="dash-actuals-actions">
              {!completed && (
                <button type="button" className="dash-actuals-btn ghost" onClick={completeWithoutActuals} disabled={isPending}>
                  Complete Without Actuals
                </button>
              )}
              <button
                type="button"
                className="dash-actuals-btn primary"
                onClick={() => submitActuals({ complete: !completed })}
                disabled={isPending}
              >
                {completed ? 'Save Actuals' : 'Complete & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
