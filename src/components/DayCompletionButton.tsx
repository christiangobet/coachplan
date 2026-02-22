'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DayStatus } from '@/lib/day-status';

export default function DayCompletionButton({
  dayId,
  status,
  missedReason,
  successRedirectHref = null
}: {
  dayId: string;
  status: DayStatus;
  missedReason?: string | null;
  successRedirectHref?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState(missedReason || '');

  useEffect(() => {
    setReasonDraft(missedReason || '');
  }, [missedReason, status]);

  async function save(nextStatus: DayStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan-days/${dayId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          reason: nextStatus === 'MISSED' ? reasonDraft : null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to update day status');
        return;
      }
      if (successRedirectHref) {
        router.replace(successRedirectHref);
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to update day status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cal-day-toggle">
      {status === 'MISSED' && (
        <textarea
          value={reasonDraft}
          onChange={(event) => setReasonDraft(event.target.value)}
          maxLength={240}
          placeholder="Optional: why this day was missed"
          className="cal-day-missed-reason"
          disabled={busy}
        />
      )}
      <div className="dash-log-actions cal-day-toggle-actions">
        <button
          type="button"
          className="dash-btn-primary"
          onClick={() => save('DONE')}
          disabled={busy || status === 'DONE'}
        >
          {busy && status !== 'DONE' ? 'Saving…' : status === 'DONE' ? '✓ Day Done' : '✓ Mark Day Done'}
        </button>
        <button
          type="button"
          className="dash-btn-ghost dash-btn-missed"
          onClick={() => save('MISSED')}
          disabled={busy}
        >
          {busy && status !== 'MISSED' ? 'Saving…' : status === 'MISSED' ? 'Update Missed Day' : 'Mark as Missed'}
        </button>
        {status !== 'OPEN' && (
          <button
            type="button"
            className="dash-btn-ghost"
            onClick={() => save('OPEN')}
            disabled={busy}
          >
            Reopen Day
          </button>
        )}
      </div>
      {error && <p className="dash-log-error">{error}</p>}
    </div>
  );
}
