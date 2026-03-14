'use client';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet';
import type { RoutePoint } from '@/lib/strava-route';

function FitRouteBounds({ routePoints }: { routePoints: RoutePoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (routePoints.length < 2) return;
    map.fitBounds(
      routePoints.map((point) => [point.lat, point.lng] as [number, number]),
      {
        padding: [24, 24],
        maxZoom: 15,
      },
    );
  }, [map, routePoints]);

  return null;
}

export default function RouteMap({
  routePoints,
  ariaLabel,
}: {
  routePoints: RoutePoint[];
  ariaLabel: string;
}) {
  if (routePoints.length < 2) return null;

  const startPoint = routePoints[0];
  const endPoint = routePoints[routePoints.length - 1];
  const center = [
    (startPoint.lat + endPoint.lat) / 2,
    (startPoint.lng + endPoint.lng) / 2,
  ] as [number, number];

  return (
    <div className="dash-route-map-shell" role="img" aria-label={ariaLabel}>
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl
        className="dash-route-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={routePoints.map((point) => [point.lat, point.lng] as [number, number])}
          pathOptions={{
            color: '#fc4c02',
            weight: 5,
            opacity: 0.92,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <CircleMarker
          center={[startPoint.lat, startPoint.lng]}
          radius={6}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: '#0f8a47',
            fillOpacity: 1,
          }}
        />
        <CircleMarker
          center={[endPoint.lat, endPoint.lng]}
          radius={6}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: '#fc4c02',
            fillOpacity: 1,
          }}
        />
        <FitRouteBounds routePoints={routePoints} />
      </MapContainer>
    </div>
  );
}
