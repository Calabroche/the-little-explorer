/**
 * POST /api/cols — mountain passes (cols) near a point.
 *
 * Given a departure { lat, lng } and a radius (km), finds named cols within
 * that radius from OpenStreetMap (nodes tagged `mountain_pass=yes` or
 * `natural=saddle`), returns each with its summit elevation and the
 * as-the-crow-flies distance from the departure, sorted nearest → farthest.
 *
 * Best-effort: if Overpass is down we return an empty list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

// Several Overpass mirrors — the public ones go down / overload often, so we
// fall through to the next on any failure or timeout.
const OVERPASS_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

interface OverpassResp { elements?: { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> }[] }

// Run an Overpass query against the mirrors in order; first one that answers
// with a valid element list wins. Each host gets a 12 s budget.
async function runOverpass(query: string): Promise<OverpassResp | null> {
  for (const url of OVERPASS_HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 22_000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json() as OverpassResp;
      if (json && Array.isArray(json.elements)) return json;
    } catch { /* timed out / network error → try next mirror */ }
  }
  return null;
}

export interface Col {
  name: string;
  kind: 'col' | 'sommet';  // mountain pass vs named summit (Mont …)
  lat:  number;
  lng:  number;
  ele:  number | null;     // summit elevation (m), when known
  distKm: number;          // straight-line distance from the departure
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, RATE_LIMITS.commune, 'cols');
  if (limited) return limited;

  let body: { lat?: number; lng?: number; radiusKm?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const { lat, lng } = body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180) {
    return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
  }
  const radiusKm = Math.max(10, Math.min(150, body.radiusKm ?? 80));

  // Use a BOUNDING BOX (index-based, fast) instead of `around` (which computes
  // a distance per node — painfully slow over big areas for natural=peak).
  // Over-fetch the square, then filter to the circle in code.
  const box = (rkm: number): string => {
    const dLat = rkm / 111;
    const dLng = rkm / (111 * Math.cos((lat! * Math.PI) / 180));
    return `${(lat! - dLat).toFixed(4)},${(lng! - dLng).toFixed(4)},${(lat! + dLat).toFixed(4)},${(lng! + dLng).toFixed(4)}`;
  };
  // Cols/saddles are sparse → cheap at the full radius. Named peaks are dense
  // (the Alps would flood a 100 km box), so cap them to a tighter box — the
  // local "monts" people ride to are within ~40 km anyway.
  const bboxCols = box(radiusKm);
  const bboxPeaks = box(Math.min(radiusKm, 15));

  const query =
    `[out:json][timeout:25];(` +
    `node(${bboxCols})[mountain_pass=yes];` +
    `node(${bboxCols})[natural=saddle][name];` +
    `node(${bboxPeaks})[natural=peak][name];` +
    `);out;`;

  const data = await runOverpass(query);
  if (!data) return NextResponse.json({ cols: [] });

  const seen = new Set<string>();
  const cols: Col[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name || el.lat == null || el.lon == null) continue;        // named cols only
    const dist = haversineKm(lat!, lng!, el.lat, el.lon);
    if (dist > radiusKm) continue;                                  // square → circle
    const key = name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const eleRaw = tags.ele ? parseFloat(tags.ele.replace(',', '.')) : NaN;
    cols.push({
      name,
      kind: tags.natural === 'peak' ? 'sommet' : 'col',
      lat: el.lat,
      lng: el.lon,
      ele: Number.isFinite(eleRaw) ? Math.round(eleRaw) : null,
      distKm: +dist.toFixed(1),
    });
  }
  cols.sort((a, b) => a.distKm - b.distKm);

  return NextResponse.json(
    { cols: cols.slice(0, 120) },
    { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
  );
}
