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
export const maxDuration = 30;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

export interface Col {
  name: string;
  kind: 'col' | 'sommet';  // mountain pass vs named summit (Mont …)
  lat:  number;
  lng:  number;
  ele:  number | null;     // summit elevation (m), when known
  distKm: number;          // straight-line distance from the departure
}

interface OverpassNode { type: 'node'; id: number; lat?: number; lon?: number; tags?: Record<string, string> }
interface OverpassResponse { elements?: OverpassNode[] }

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
  const radiusKm = Math.max(10, Math.min(200, body.radiusKm ?? 100));
  const radiusM = Math.round(radiusKm * 1000);
  const c = `${radiusM},${lat!.toFixed(5)},${lng!.toFixed(5)}`;

  const query =
    `[out:json][timeout:25];(` +
    `node(around:${c})[mountain_pass=yes];` +
    `node(around:${c})[natural=saddle][name];` +
    `node(around:${c})[natural=peak][name];` +
    `);out;`;

  let data: OverpassResponse;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) return NextResponse.json({ cols: [] });
    data = await res.json() as OverpassResponse;
  } catch {
    return NextResponse.json({ cols: [] });
  }

  const seen = new Set<string>();
  const cols: Col[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name || el.lat == null || el.lon == null) continue;        // named cols only
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
      distKm: +haversineKm(lat!, lng!, el.lat, el.lon).toFixed(1),
    });
  }
  cols.sort((a, b) => a.distKm - b.distKm);

  return NextResponse.json(
    { cols: cols.slice(0, 100) },
    { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
  );
}
