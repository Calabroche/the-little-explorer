import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, enforceBodySize, RATE_LIMITS } from '@/lib/rate-limit';

// Proxy to opentopodata.org's eudem25m dataset (25 m resolution DEM
// covering Europe). Free, no key, but limited to 100 locations per
// request and 1 call/sec / 1000 calls/day.
//
// Client posts up to 100 [lat, lng] points; we forward, normalise the
// response to a flat number[] of elevations (m), preserving order.
//
// Per-IP rate-limited to protect the upstream quota — the route is
// unauthenticated (the iOS app + web both call it) so any leaked URL
// could otherwise burn our daily 1000-call budget in minutes.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface OpenTopoResp {
  status:  string;
  results: { elevation: number | null; location: { lat: number; lng: number } }[];
  error?:  string;
}

const MAX_POINTS = 100;

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, RATE_LIMITS.elevation, 'elevation');
  if (limited) return limited;
  // Body cap = 50 KB. 100 points × ~20 bytes per [lat,lng] pair = 2 KB.
  // Even with comments / whitespace, 50 KB is comfortably 25× over.
  const tooBig = enforceBodySize(req, 50_000);
  if (tooBig) return tooBig;

  let body: { points?: [number, number][] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const pts = body.points;
  if (!Array.isArray(pts) || pts.length === 0) {
    return NextResponse.json({ error: 'no_points' }, { status: 400 });
  }
  if (pts.length > MAX_POINTS) {
    return NextResponse.json({ error: 'too_many_points', max: MAX_POINTS }, { status: 400 });
  }
  for (const [lat, lng] of pts) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
    }
  }

  const locations = pts.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|');
  const url = `https://api.opentopodata.org/v1/eudem25m?locations=${locations}`;

  try {
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!upstream.ok) {
      // Opentopodata returns 429 when rate-limited; surface it so the client
      // can fall back gracefully (the elevation chart is decorative).
      return NextResponse.json({ error: `opentopodata ${upstream.status}` }, { status: upstream.status === 429 ? 429 : 502 });
    }
    const data = await upstream.json() as OpenTopoResp;
    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      return NextResponse.json({ error: data.error || data.status || 'unknown' }, { status: 502 });
    }
    const elevations = data.results.map(r => r.elevation ?? 0);
    return NextResponse.json({ elevations }, {
      headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
