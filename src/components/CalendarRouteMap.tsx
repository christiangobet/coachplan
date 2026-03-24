'use client';
// Thin client wrapper so the server-component calendar page can render a Leaflet map.
import dynamic from 'next/dynamic';
import type { RoutePoint } from '@/lib/strava-route';

const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => <div className="cal-log-route-map-loading" aria-hidden="true" />,
});

export default function CalendarRouteMap({
  routePoints,
  ariaLabel,
}: {
  routePoints: RoutePoint[];
  ariaLabel: string;
}) {
  return (
    <div className="day-log-inline-route-map cal-log-route-map">
      <RouteMap routePoints={routePoints} ariaLabel={ariaLabel} />
    </div>
  );
}
