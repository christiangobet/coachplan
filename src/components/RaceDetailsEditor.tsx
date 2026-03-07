'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type WeekDateAnchor = 'RACE_DATE' | 'START_DATE';

type Props = {
  planId: string;
  initialRaceName: string;
  initialRaceDate: string;
  initialStartDate?: string;
  initialWeekDateAnchor?: WeekDateAnchor;
};

export default function RaceDetailsEditor({
  planId,
  initialRaceName,
  initialRaceDate,
  initialStartDate = '',
  initialWeekDateAnchor
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raceName, setRaceName] = useState(initialRaceName);
  const [weekDateAnchor, setWeekDateAnchor] = useState<WeekDateAnchor>(
    initialWeekDateAnchor || (initialRaceDate ? 'RACE_DATE' : initialStartDate ? 'START_DATE' : 'RACE_DATE')
  );
  const [raceDate, setRaceDate] = useState(initialRaceDate);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    if (weekDateAnchor === 'RACE_DATE' && !raceDate) {
      setStatus('Race date is required when alignment is set to race date');
      return;
    }
    if (weekDateAnchor === 'START_DATE' && !startDate) {
      setStatus('Training start date is required when alignment is set to Week 1 start');
      return;
    }
    setSaving(true);
    setStatus('Saving...');
    try {
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceName: raceName.trim() || null,
          raceDate: raceDate || null,
          startDate: startDate || null,
          weekDateAnchor
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
      const weekList = Array.isArray(data?.plan?.weeks) ? data.plan.weeks : [];
      const weekOne = [...weekList].sort((a, b) => Number(a?.weekIndex || 0) - Number(b?.weekIndex || 0))[0];
      const nextStartDate = typeof weekOne?.startDate === 'string' ? weekOne.startDate.slice(0, 10) : startDate;
      setStartDate(nextStartDate || '');
      setStatus('Race details saved');
      router.refresh();
    } catch {
      setStatus('Failed to save race details');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cal-race-editor" data-debug-id="RDE">
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
          <label>
            Training start date (W1)
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            Calendar alignment
            <div className="cal-race-editor-anchor-toggle">
              <label className="cal-race-editor-anchor-option">
                <input
                  type="radio"
                  name={`week-date-anchor-${planId}`}
                  value="RACE_DATE"
                  checked={weekDateAnchor === 'RACE_DATE'}
                  onChange={() => setWeekDateAnchor('RACE_DATE')}
                />
                <span>Race date</span>
              </label>
              <label className="cal-race-editor-anchor-option">
                <input
                  type="radio"
                  name={`week-date-anchor-${planId}`}
                  value="START_DATE"
                  checked={weekDateAnchor === 'START_DATE'}
                  onChange={() => setWeekDateAnchor('START_DATE')}
                />
                <span>Training start date (W1)</span>
              </label>
            </div>
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
