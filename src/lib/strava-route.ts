type RoutePoint = {
  lat: number;
  lng: number;
};

type SvgPoint = {
  x: number;
  y: number;
};

export type StravaRoutePreview = {
  hasRoute: boolean;
  name: string | null;
  sportType: string | null;
  startTime: string;
  distanceM: number | null;
  movingTimeSec: number | null;
  elevationGainM: number | null;
  polyline: string;
  svgPoints: SvgPoint[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractStravaPolyline(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const map = isRecord(raw.map) ? raw.map : null;
  if (!map) return null;
  return normalizeText(map.summary_polyline) || normalizeText(map.polyline);
}

export function decodePolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const latDelta = result & 1 ? ~(result >> 1) : result >> 1;
    lat += latDelta;

    shift = 0;
    result = 0;

    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const lngDelta = result & 1 ? ~(result >> 1) : result >> 1;
    lng += lngDelta;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}

export function normalizeRouteForSvg(points: RoutePoint[]): SvgPoint[] {
  if (points.length === 0) return [];

  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = maxLng - minLng || 1;
  const height = maxLat - minLat || 1;
  const size = 100;
  const padding = 8;
  const drawable = size - padding * 2;

  return points.map((point) => ({
    x: padding + ((point.lng - minLng) / width) * drawable,
    y: size - (padding + ((point.lat - minLat) / height) * drawable),
  }));
}

export function buildStravaRoutePreview(input: {
  name: string | null;
  sportType: string | null;
  startTime: Date | string;
  distanceM: number | null;
  movingTimeSec: number | null;
  elevationGainM: number | null;
  raw: unknown;
}): StravaRoutePreview | null {
  const polyline = extractStravaPolyline(input.raw);
  if (!polyline) return null;

  const decoded = decodePolyline(polyline);
  if (decoded.length < 2) return null;

  const svgPoints = normalizeRouteForSvg(decoded);
  if (svgPoints.length < 2) return null;

  const startTime =
    input.startTime instanceof Date
      ? input.startTime.toISOString()
      : new Date(input.startTime).toISOString();

  return {
    hasRoute: true,
    name: normalizeText(input.name),
    sportType: normalizeText(input.sportType),
    startTime,
    distanceM: typeof input.distanceM === "number" ? input.distanceM : null,
    movingTimeSec: typeof input.movingTimeSec === "number" ? input.movingTimeSec : null,
    elevationGainM: typeof input.elevationGainM === "number" ? input.elevationGainM : null,
    polyline,
    svgPoints,
  };
}
