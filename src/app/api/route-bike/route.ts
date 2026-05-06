import { NextRequest, NextResponse } from 'next/server';

// Proxy to a public OSRM cycling-profile router.
// Takes an ordered list of [lat, lng] waypoints and returns the cycling
// route geometry + total distance + duration.
//
// Upstream: routing.openstreetmap.de (OSM-DE community-run OSRM with the
// cycling profile baked in). Free for low-volume use. The URL still uses
// the /driving/ slug because OSRM's API path is fixed; the host prefix
// (`routed-bike`) is what selects the cycling profile.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface OsrmRoute {
  distance: number;                    // meters
  duration: number;                    // seconds
  geometry: { type: 'LineString'; coordinates: [number, number][] }; // [lng, lat]
}

interface OsrmResponse {
  code:   string;
  routes: OsrmRoute[];
  message?: string;
}

export async function POST(req: NextRequest) {
  let body: { waypoints?: [number, number][] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const wp = body.waypoints;
  if (!Array.isArray(wp) || wp.length < 2) {
    return NextResponse.json({ error: 'need_at_least_2_waypoints' }, { status: 400 });
  }
  if (wp.length > 25) {
    return NextResponse.json({ error: 'too_many_waypoints' }, { status: 400 });
  }
  // Validate each pair is finite numbers in lat/lng range.
  for (const [lat, lng] of wp) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
    }
  }

  // OSRM expects coords as `lng,lat;lng,lat;...`
  const coords = wp.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coords}`
    + `?overview=full&geometries=geojson&steps=false&alternatives=false`;

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
    // Flip back from [lng,lat] to [lat,lng] for client consumption.
    const geometry = r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
    return NextResponse.json({
      distance_m: r.distance,
      duration_s: r.duration,
      geometry,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
