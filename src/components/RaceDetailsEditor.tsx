'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  planId: string;
  initialRaceName: string;
  initialRaceDate: string;
};

export default function RaceDetailsEditor({
  planId,
  initialRaceName,
  initialRaceDate
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raceName, setRaceName] = useState(initialRaceName);
  const [raceDate, setRaceDate] = useState(initialRaceDate);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setStatus('Saving...');
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceName: raceName.trim() || null,
          raceDate: raceDate || null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data?.error || 'Failed to save race details');
        return;
      }
      setRaceName(data?.plan?.raceName || '');
      const nextDate = typeof data?.plan?.raceDate === 'string'
        ? data.plan.raceDate.slice(0, 10)
        : raceDate;
      setRaceDate(nextDate || '');
      setStatus('Race details saved');
      router.refresh();
    } catch {
      setStatus('Failed to save race details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cal-race-editor">
      <button
        type="button"
        className="dash-sync-btn"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? 'Close race edit' : 'Edit race details'}
      </button>
      {open && (
        <div className="cal-race-editor-form">
          <label>
            Race name
            <input
              type="text"
              value={raceName}
              onChange={(event) => setRaceName(event.target.value)}
              placeholder="e.g. Berlin Marathon 2026"
            />
          </label>
          <label>
            Race date
            <input
              type="date"
              value={raceDate}
              onChange={(event) => setRaceDate(event.target.value)}
            />
          </label>
          <div className="cal-race-editor-actions">
            <button
              type="button"
              className="dash-sync-btn"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {status && <span>{status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
