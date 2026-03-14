'use client';

import { useEffect } from 'react';
import type { StravaRoutePreview } from '@/lib/strava-route';
import {
  convertDistanceForDisplay,
  distanceUnitLabel,
  formatDistanceNumber,
  type DistanceUnit,
} from '@/lib/unit-display';

function formatRouteDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatMovingTime(value: number | null) {
  if (!value || value <= 0) return null;
  const totalMinutes = Math.round(value / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

function buildPolylinePoints(routePreview: StravaRoutePreview | null) {
  if (!routePreview || routePreview.svgPoints.length < 2) return '';
  return routePreview.svgPoints.map((point) => `${point.x},${point.y}`).join(' ');
}

export default function ActivityRouteSheet({
  isOpen,
  routePreview,
  viewerUnits,
  onClose,
}: {
  isOpen: boolean;
  routePreview: StravaRoutePreview | null;
  viewerUnits: DistanceUnit;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const routePoints = buildPolylinePoints(routePreview);
  const distance = routePreview?.distanceM
    ? convertDistanceForDisplay(routePreview.distanceM / 1000, 'KM', viewerUnits)
    : null;
  const movingTime = formatMovingTime(routePreview?.movingTimeSec ?? null);
  const elevation = routePreview?.elevationGainM
    ? `${Math.round(routePreview.elevationGainM)} m gain`
    : null;
  const routeDate = routePreview ? formatRouteDate(routePreview.startTime) : '';

  return (
    <div className="dash-route-sheet-layer">
      <button
        type="button"
        className="dash-route-sheet-scrim"
        aria-label="Close route sheet"
        onClick={onClose}
      />
      <section
        className="dash-route-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={routePreview?.name ? `${routePreview.name} route preview` : 'Route preview'}
      >
        <div className="dash-route-sheet-handle" aria-hidden="true" />
        <div className="dash-route-sheet-header">
          <div className="dash-route-sheet-heading">
            <span className="dash-route-sheet-kicker">Route preview</span>
            <h3>{routePreview?.name || 'Workout route'}</h3>
            <p>
              {[routePreview?.sportType, routeDate].filter(Boolean).join(' · ') || 'Imported from Strava'}
            </p>
          </div>
          <button type="button" className="dash-route-sheet-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="dash-route-sheet-body">
          {routePreview && routePoints ? (
            <div className="dash-route-map-card">
              <svg
                className="dash-route-map"
                viewBox="0 0 100 100"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={routePreview.name ? `${routePreview.name} route preview` : 'Route preview'}
              >
                <polyline
                  className="dash-route-map-line"
                  points={routePoints}
                />
                <circle className="dash-route-map-start" cx={routePreview.svgPoints[0].x} cy={routePreview.svgPoints[0].y} r="2.6" />
                <circle
                  className="dash-route-map-end"
                  cx={routePreview.svgPoints[routePreview.svgPoints.length - 1].x}
                  cy={routePreview.svgPoints[routePreview.svgPoints.length - 1].y}
                  r="2.6"
                />
              </svg>
            </div>
          ) : (
            <div className="dash-route-map-fallback">
              Route map unavailable for this activity
            </div>
          )}

          <div className="dash-route-stats">
            {distance && (
              <div className="dash-route-stat">
                <span>Distance</span>
                <strong>{formatDistanceNumber(distance.value)} {distanceUnitLabel(distance.unit)}</strong>
              </div>
            )}
            {movingTime && (
              <div className="dash-route-stat">
                <span>Moving time</span>
                <strong>{movingTime}</strong>
              </div>
            )}
            {elevation && (
              <div className="dash-route-stat">
                <span>Elevation</span>
                <strong>{elevation}</strong>
              </div>
            )}
          </div>

          <p className="dash-route-sheet-source">Imported from Strava</p>
        </div>
      </section>
    </div>
  );
}
