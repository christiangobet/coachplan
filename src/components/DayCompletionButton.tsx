'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DayCompletionButton({
  dayId,
  completed
}: {
  dayId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan-days/${dayId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !completed })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to update day status');
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
      <button
        type="button"
        className={`dash-sync-btn ${completed ? 'is-done' : ''}`}
        onClick={toggle}
        disabled={busy}
      >
        {busy ? 'Saving...' : completed ? 'Mark Day Not Done' : 'Mark Day Done'}
      </button>
      {error && <span className="cal-day-toggle-error">{error}</span>}
    </div>
  );
}
