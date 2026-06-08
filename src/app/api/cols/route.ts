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
export const maxDuration = 60;

// Overpass mirrors, best-first. The public instances overload constantly
// (overpass-api.de 504s under load; some are regional extracts that answer 200
// with ZERO elements for France, which is worse than an error). The French
// instance is fast and reliable for our area, so it leads. We RACE all mirrors
// in parallel AND retry each on failure until a shared deadline — so a
// transient 504 self-heals instead of bubbling up as "no col found".
const OVERPASS_HOSTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',  // FR, fast + reliable here
  'https://overpass-api.de/api/interpreter',            // canonical, often busy
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

interface OverpassResp { elements?: { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> }[] }

async function fetchOverpass(url: string, query: string, timeoutMs: number): Promise<OverpassResp> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(query),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const json = await res.json() as OverpassResp;
    if (!json || !Array.isArray(json.elements)) throw new Error('bad shape');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Race every mirror, each retrying on failure until the shared deadline. First
// valid answer wins; returns null only if every mirror keeps failing for the
// whole budget.
async function runOverpass(query: string, perAttemptMs: number, deadlineMs: number): Promise<OverpassResp | null> {
  const deadline = Date.now() + deadlineMs;
  const tryHost = async (url: string): Promise<OverpassResp> => {
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        return await fetchOverpass(url, query, perAttemptMs);
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 600));  // brief backoff before retry
      }
    }
    throw lastErr ?? new Error('deadline');
  };
  try {
    return await Promise.any(OVERPASS_HOSTS.map(tryHost));
  } catch {
    return null;
  }
}

export interface Col {
  name: string;
  kind: 'col' | 'sommet';  // mountain pass vs named summit (Mont …)
  lat:  number;
  lng:  number;
  ele:  number | null;     // summit elevation (m), when known
  distKm: number;          // straight-line distance from the departure
  city: string | null;     // commune / village the col sits in (reverse-geocoded)
}

// Minimal CSV line parser (handles quoted fields — BAN quotes the context
// column which contains commas).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Reverse-geocode every col in ONE batch via the French BAN address API's
// CSV endpoint, attaching the commune (result_city). Best-effort.
async function attachCities(cols: Col[]): Promise<void> {
  if (cols.length === 0) return;
  const csv = 'latitude,longitude\n' + cols.map(c => `${c.lat},${c.lng}`).join('\n');
  try {
    const form = new FormData();
    form.append('data', new Blob([csv], { type: 'text/csv' }), 'cols.csv');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch('https://api-adresse.data.gouv.fr/reverse/csv/', { method: 'POST', body: form, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const lines = (await res.text()).split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return;
    const header = parseCsvLine(lines[0]);
    const cityIdx = header.indexOf('result_city');
    if (cityIdx < 0) return;
    for (let i = 1; i < lines.length && i - 1 < cols.length; i++) {
      const city = parseCsvLine(lines[i])[cityIdx]?.trim();
      if (city) cols[i - 1].city = city;
    }
  } catch { /* best-effort — cols still returned without a city */ }
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

  // Two independent queries, raced in parallel. Cols/saddles are the headline
  // result and get the bigger budget; named peaks are a heavier, best-effort
  // extra (if their query keeps failing we still return the cols). This way a
  // slow peaks lookup can never sink the whole response.
  const colsQuery =
    `[out:json][timeout:25];(` +
    `node(${bboxCols})[mountain_pass=yes];` +
    `node(${bboxCols})[natural=saddle][name];` +
    `);out;`;
  const peaksQuery =
    `[out:json][timeout:20];(node(${bboxPeaks})[natural=peak][name];);out;`;

  const [colsData, peaksData] = await Promise.all([
    runOverpass(colsQuery, 14_000, 40_000),
    runOverpass(peaksQuery, 12_000, 24_000),
  ]);
  if (!colsData && !peaksData) return NextResponse.json({ cols: [] });
  const elements = [...(colsData?.elements ?? []), ...(peaksData?.elements ?? [])];

  const seen = new Set<string>();
  const cols: Col[] = [];
  for (const el of elements) {
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
      city: null,
    });
  }
  cols.sort((a, b) => a.distKm - b.distKm);
  const top = cols.slice(0, 120);
  await attachCities(top);

  return NextResponse.json(
    { cols: top },
    { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
  );
}
