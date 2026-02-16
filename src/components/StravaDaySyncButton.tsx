'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SyncState = 'idle' | 'syncing' | 'done';

export default function StravaDaySyncButton({
  dateISO,
  className
}: {
  dateISO: string;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<SyncState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    if (state === 'syncing') return;
    setState('syncing');
    setError(null);

    try {
      const res = await fetch('/api/integrations/strava/import-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateISO })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || 'Sync failed');
      }
      setState('done');
      router.refresh();
      window.setTimeout(() => setState('idle'), 2400);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setState('idle');
    }
  };

  const label = state === 'syncing' ? 'Syncing…' : state === 'done' ? 'Synced' : 'Sync Day Log';

  return (
    <button
      type="button"
      className={className || 'dash-btn-secondary'}
      onClick={handleSync}
      disabled={state === 'syncing'}
      title={error || `Import Strava logs for ${dateISO}`}
    >
      {label}
    </button>
  );
}
