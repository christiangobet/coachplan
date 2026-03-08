'use client';

import { useState } from 'react';
import DayLogCard from './DayLogCard';
import type { LogActivity } from '@/lib/log-activity';
import type { DayStatus } from '@/lib/day-status';

type LogDay = {
  dayId: string;
  dateISO: string;
  dateLabel: string;
  planId: string;
  viewerUnits: 'KM' | 'MILES';
  activities: LogActivity[];
  initialDayStatus: DayStatus;
  initialMissedReason: string | null;
  stravaConnected: boolean;
};

export type StatusFeedItem = {
  alert: boolean;
  text: string;
  logDay?: LogDay;
};

export default function DashboardTrainingLogStatus({ items }: { items: StatusFeedItem[] }) {
  const [openDayId, setOpenDayId] = useState<string | null>(null);

  return (
    <div className="dash-status-feed">
      {items.map((item, i) => (
        <div key={i} className="dash-status-group">
          <div className="dash-status-item">
            <span className={`dash-status-dot ${item.alert ? 'warn' : 'ok'}`} />
            <span className="dash-status-text">{item.text}</span>
            {item.logDay && (
              <button
                type="button"
                className="dash-status-cta"
                onClick={() =>
                  setOpenDayId(openDayId === item.logDay!.dayId ? null : item.logDay!.dayId)
                }
              >
                {openDayId === item.logDay!.dayId ? 'Close' : 'Log day'}
              </button>
            )}
          </div>
          {item.logDay && openDayId === item.logDay.dayId && (() => {
            return (
              <div className="dash-status-log-panel">
                <DayLogCard
                  dayId={item.logDay.dayId}
                  dateISO={item.logDay.dateISO}
                  planId={item.logDay.planId}
                  activities={item.logDay.activities}
                  viewerUnits={item.logDay.viewerUnits}
                  dayStatus={item.logDay.initialDayStatus}
                  missedReason={item.logDay.initialMissedReason}
                  stravaConnected={item.logDay.stravaConnected}
                  enabled
                  onClose={() => setOpenDayId(null)}
                />
              </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
}
