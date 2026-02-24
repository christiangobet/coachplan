'use client';

import { useEffect, useState } from 'react';
import type { DayStatus } from '@/lib/day-status';
import type { LogActivity } from '@/lib/log-activity';
import type { DistanceUnit } from '@/lib/unit-display';
import DayLogCard from '@/components/DayLogCard';

const ANCHOR_ID = 'dash-activity-log-card';
const HASH_TARGET = `#${ANCHOR_ID}`;

export default function DashboardDayLogShell({
  dayId,
  dateISO,
  planId,
  activities,
  viewerUnits,
  dayStatus,
  missedReason,
  stravaConnected,
}: {
  dayId: string | null;
  dateISO: string;
  planId: string;
  activities: LogActivity[];
  viewerUnits: DistanceUnit;
  dayStatus: DayStatus;
  missedReason?: string | null;
  stravaConnected: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Open automatically when navigated via hash link (e.g. from hero "Log today" button)
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === HASH_TARGET) setOpen(true);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  const close = () => {
    setOpen(false);
    if (typeof window !== 'undefined' && window.location.hash === HASH_TARGET) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  return (
    <section id={ANCHOR_ID} className={`dash-log-section${open ? '' : ' is-closed'}`}>
      {!open ? (
        <div className="dash-log-collapsed">
          <button
            type="button"
            className={`dash-btn-secondary${dayStatus === 'DONE' ? ' is-done' : dayStatus === 'MISSED' ? ' is-missed' : ''}`}
            onClick={() => setOpen(true)}
          >
            {dayStatus === 'DONE' ? (
              <><span className="dash-log-collapsed-tick">✓</span> Day logged — review log</>
            ) : dayStatus === 'PARTIAL' ? (
              <><span className="dash-log-collapsed-tick">✓</span> Partial day logged — review log</>
            ) : dayStatus === 'MISSED' ? (
              '✗ Day missed — reopen'
            ) : (
              'Log today\'s workout'
            )}
          </button>
        </div>
      ) : (
        <>
          <div className="dash-log-header">
            <span className="dash-log-label">Log today</span>
            <button type="button" className="dash-log-close-btn" onClick={close}>
              ✕
            </button>
          </div>
          <DayLogCard
            dayId={dayId}
            dateISO={dateISO}
            planId={planId}
            activities={activities}
            viewerUnits={viewerUnits}
            dayStatus={dayStatus}
            missedReason={missedReason}
            stravaConnected={stravaConnected}
            enabled
          />
        </>
      )}
    </section>
  );
}
