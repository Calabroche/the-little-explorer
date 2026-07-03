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
//   waypoints (required): [[lat,lng], ...]   — at least 2. OSRM caps a
//                                               single request at 25
//                                               coordinates, so longer
//                                               routes are split into
//                                               overlapping 25-point
//                                               chunks and stitched back
//                                               together (see below).
//   steps     (optional): boolean             — when true, OSRM returns
//                                               turn-by-turn maneuvers
//                                               (used by the navigation
//                                               view; planning skips it
//                                               to keep responses small)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Chunked routes fan out to several sequential OSRM calls, so give the
// function more headroom than the 10s Vercel default.
export const maxDuration = 30;

// OSRM's public endpoint rejects more than 25 coordinates per request. We
// route in chunks of CHUNK waypoints that overlap by one point (each
// chunk's last stop is the next chunk's first), then concatenate the
// geometry / distance / duration / steps. MAX_WP is a sane abuse guard,
// not an OSRM limit — a hand-drawn route never needs hundreds of points.
const CHUNK = 25;
const MAX_WP = 300;

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
  // Body cap = 16 KB. 300 waypoints × ~22 bytes ≈ 6.6 KB; 16 KB leaves
  // ample headroom for JSON overhead and the steps flag.
  const tooBig = enforceBodySize(req, 16_000);
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
  if (wp.length > MAX_WP) {
    return NextResponse.json({ error: 'too_many_waypoints' }, { status: 400 });
  }
  for (const [lat, lng] of wp) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
    }
  }

  // Split into overlapping chunks of at most CHUNK points. Each chunk shares
  // its last waypoint with the next chunk's first, so the stitched geometry
  // is continuous. `i += CHUNK - 1` advances by the non-overlapping amount.
  const chunks: [number, number][][] = [];
  for (let i = 0; i < wp.length - 1; i += CHUNK - 1) {
    chunks.push(wp.slice(i, i + CHUNK));
  }

  try {
    const geometry: [number, number][] = [];
    let distance = 0;
    let duration = 0;
    const outSteps: NavStep[] | undefined = steps ? [] : undefined;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (chunk.length < 2) continue; // trailing lone overlap point — nothing to route

      const coords = chunk.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
      const url = `https://routing.openstreetmap.de/${osrmHost}/route/v1/driving/${coords}`
        + `?overview=full&geometries=geojson&alternatives=false`
        + `&steps=${steps ? 'true' : 'false'}`;

      const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!upstream.ok) {
        return NextResponse.json({ error: `osrm ${upstream.status}` }, { status: 502 });
      }
      const data = await upstream.json() as OsrmResponse;
      if (data.code !== 'Ok' || !data.routes?.length) {
        return NextResponse.json({ error: data.message || data.code || 'no_route' }, { status: 502 });
      }
      const r = data.routes[0];
      distance += r.distance;
      duration += r.duration;

      const geo = r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      // Drop the first vertex of every chunk after the first: it repeats the
      // previous chunk's last vertex (the shared overlap waypoint).
      geometry.push(...(ci === 0 ? geo : geo.slice(1)));

      // Flatten leg → step, keep only what the client needs.
      if (outSteps && r.legs) {
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
    }

    if (geometry.length < 2) {
      return NextResponse.json({ error: 'no_route' }, { status: 502 });
    }

    return NextResponse.json({
      distance_m: distance,
      duration_s: duration,
      geometry,
      ...(outSteps ? { steps: outSteps } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
