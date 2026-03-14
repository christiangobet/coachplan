import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRoot = process.cwd();

async function loadStravaRouteModule() {
  return import(pathToFileURL(path.join(workspaceRoot, "src/lib/strava-route.ts")).href);
}

test("extractStravaPolyline prefers summary polyline when present", async () => {
  const { extractStravaPolyline } = await loadStravaRouteModule();

  assert.equal(
    extractStravaPolyline({
      map: {
        summary_polyline: "summary-polyline",
        polyline: "full-polyline",
      },
    }),
    "summary-polyline",
  );
});

test("extractStravaPolyline falls back to full polyline", async () => {
  const { extractStravaPolyline } = await loadStravaRouteModule();

  assert.equal(
    extractStravaPolyline({
      map: {
        polyline: "full-polyline",
      },
    }),
    "full-polyline",
  );
});

test("decodePolyline decodes a standard encoded route", async () => {
  const { decodePolyline } = await loadStravaRouteModule();
  const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");

  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { lat: 38.5, lng: -120.2 });
  assert.deepEqual(points[2], { lat: 43.252, lng: -126.453 });
});

test("normalizeRouteForSvg fits decoded points into a drawable box", async () => {
  const { normalizeRouteForSvg } = await loadStravaRouteModule();
  const normalized = normalizeRouteForSvg([
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);

  assert.equal(normalized.length, 3);
  for (const point of normalized) {
    assert.ok(point.x >= 0 && point.x <= 100);
    assert.ok(point.y >= 0 && point.y <= 100);
  }
});

test("buildStravaRoutePreview returns null when no route geometry exists", async () => {
  const { buildStravaRoutePreview } = await loadStravaRouteModule();

  const preview = buildStravaRoutePreview({
    name: "Morning Run",
    sportType: "Run",
    startTime: new Date("2026-03-13T07:15:00Z"),
    distanceM: 12800,
    movingTimeSec: 4980,
    elevationGainM: 640,
    raw: {},
  });

  assert.equal(preview, null);
});

test("buildStravaRoutePreview reads geometry and metrics from Strava raw payload", async () => {
  const { buildStravaRoutePreview } = await loadStravaRouteModule();

  const preview = buildStravaRoutePreview({
    name: "Morning Trail Run",
    sportType: "TrailRun",
    startTime: new Date("2026-03-13T07:15:00Z"),
    distanceM: 12800,
    movingTimeSec: 4980,
    elevationGainM: 640,
    raw: {
      map: {
        summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
      },
    },
  });

  assert.equal(preview?.hasRoute, true);
  assert.equal(preview?.name, "Morning Trail Run");
  assert.equal(preview?.sportType, "TrailRun");
  assert.equal(preview?.distanceM, 12800);
  assert.equal(preview?.movingTimeSec, 4980);
  assert.equal(preview?.elevationGainM, 640);
  assert.equal(preview?.routePoints.length, 3);
  assert.deepEqual(preview?.routePoints[0], { lat: 38.5, lng: -120.2 });
  assert.equal(preview?.svgPoints.length, 3);
});
