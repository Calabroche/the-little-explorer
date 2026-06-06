import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, enforceBodySize, RATE_LIMITS } from '@/lib/rate-limit';

// Proxy to a public OSRM cycling-profile router.
// Takes an ordered list of [lat, lng] waypoints and returns the cycling
// route geometry + total distance + duration.
//
// Upstream: routing.openstreetmap.de (OSM-DE community-run OSRM with the
// cycling profile baked in). Free for low-volume use. The URL still uses
// the /driving/ slug because OSRM's API path is fixed; the host prefix
// (`routed-bike`) is what selects the cycling profile.
//
// POST body fields:
//   waypoints (required): [[lat,lng], ...]   — at least 2, max 25
//   steps     (optional): boolean             — when true, OSRM returns
//                                               turn-by-turn maneuvers
//                                               (used by the navigation
//                                               view; planning skips it
//                                               to keep responses small)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface OsrmManeuver {
  type:            string;
  modifier?:       string;
  location:        [number, number]; // [lng, lat]
  bearing_before?: number;
  bearing_after?:  number;
  exit?:           number;
}

interface OsrmStep {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  maneuver: OsrmManeuver;
  name:     string;
  distance: number;
  duration: number;
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: [number, number][] }; // [lng, lat]
  legs?:    { steps?: OsrmStep[] }[];
}

interface OsrmResponse {
  code:     string;
  routes:   OsrmRoute[];
  message?: string;
}

// Trimmed step shape we return to the client. Coords are flipped to
// [lat, lng] like the rest of the app.
export interface NavStep {
  start:    [number, number];     // maneuver location (where the action happens)
  type:     string;
  modifier: string;
  exit:     number | null;
  name:     string;               // street / road name (after the maneuver)
  distance: number;               // meters covered by this step
  duration: number;               // seconds
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, RATE_LIMITS.routeBike, 'route-bike');
  if (limited) return limited;
  // Body cap = 10 KB. 25 waypoints × ~25 bytes = 625 B; even
  // with steps:true and verbose payloads, 10 KB is way overhead.
  const tooBig = enforceBodySize(req, 10_000);
  if (tooBig) return tooBig;

  let body: { waypoints?: [number, number][]; steps?: boolean; profile?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const wp    = body.waypoints;
  const steps = !!body.steps;
  // 'foot' for running (allows footpaths / pedestrian ways), 'bike' default.
  const osrmHost = body.profile === 'foot' ? 'routed-foot' : 'routed-bike';
  if (!Array.isArray(wp) || wp.length < 2) {
    return NextResponse.json({ error: 'need_at_least_2_waypoints' }, { status: 400 });
  }
  if (wp.length > 25) {
    return NextResponse.json({ error: 'too_many_waypoints' }, { status: 400 });
  }
  for (const [lat, lng] of wp) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
    }
  }

  const coords = wp.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `https://routing.openstreetmap.de/${osrmHost}/route/v1/driving/${coords}`
    + `?overview=full&geometries=geojson&alternatives=false`
    + `&steps=${steps ? 'true' : 'false'}`;

  try {
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `osrm ${upstream.status}` }, { status: 502 });
    }
    const data = await upstream.json() as OsrmResponse;
    if (data.code !== 'Ok' || !data.routes?.length) {
      return NextResponse.json({ error: data.message || data.code || 'no_route' }, { status: 502 });
    }
    const r = data.routes[0];
    const geometry = r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);

    // Flatten leg → step, keep only what the client needs.
    let outSteps: NavStep[] | undefined;
    if (steps && r.legs) {
      outSteps = [];
      for (const leg of r.legs) {
        if (!leg.steps) continue;
        for (const s of leg.steps) {
          const [lng, lat] = s.maneuver.location;
          outSteps.push({
            start:    [lat, lng],
            type:     s.maneuver.type,
            modifier: s.maneuver.modifier ?? '',
            exit:     s.maneuver.exit ?? null,
            name:     s.name ?? '',
            distance: s.distance,
            duration: s.duration,
          });
        }
      }
    }

    return NextResponse.json({
      distance_m: r.distance,
      duration_s: r.duration,
      geometry,
      ...(outSteps ? { steps: outSteps } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
