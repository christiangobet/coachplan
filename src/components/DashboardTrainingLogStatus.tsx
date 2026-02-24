'use client';

import { useState } from 'react';
import DayLogCard from './DayLogCard';
import type { LogActivity } from '@/lib/log-activity';
import type { DayStatus } from '@/lib/day-status';

const TYPE_ABBR: Record<string, string> = {
  RUN: 'RUN', STRENGTH: 'STR', CROSS_TRAIN: 'XT',
  REST: 'RST', MOBILITY: 'MOB', YOGA: 'YOG', HIKE: 'HIK', OTHER: 'OTH',
};
function typeAbbr(type: string) {
  return TYPE_ABBR[type.toUpperCase()] || 'OTH';
}

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
            const primary = item.logDay.activities.find(a => a.type !== 'REST') ?? item.logDay.activities[0];
            return (
              <div className="dash-status-log-panel">
                {primary && (
                  <div className="dash-status-workout-row">
                    <span className={`dash-type-badge dash-type-${primary.type}`}>
                      {typeAbbr(primary.type)}
                    </span>
                    <div className="dash-status-workout-info">
                      <span className="dash-status-workout-title">{primary.title || primary.type}</span>
                      {primary.plannedDetails.length > 0 && (
                        <span className="dash-status-workout-metrics">
                          {primary.plannedDetails.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                )}
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
