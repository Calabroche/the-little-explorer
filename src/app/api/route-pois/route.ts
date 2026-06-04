/**
 * POST /api/route-pois — resupply points along a cycling route.
 *
 * Given the route geometry, finds OpenStreetMap places near the line where
 * a rider can refill water or grab food:
 *   • water     — drinking-water taps, fountains, and cemeteries (French
 *                 cemeteries almost always have a tap — a classic rider hack)
 *   • supermarket / convenience (supérette) / bakery (boulangerie)
 *
 * Implementation: downsample the route to a bounded set of points, ask
 * Overpass for the relevant amenities/shops within ~120 m of any of them
 * (`around`), then categorise + dedupe + keep the closest-to-route examples.
 *
 * Best-effort: if Overpass is down / rate-limits us we return an empty list
 * rather than failing the planner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

export type PoiCategory = 'water' | 'supermarket' | 'convenience' | 'bakery';

export interface Poi {
  cat:  PoiCategory;
  name: string | null;
  lat:  number;
  lng:  number;
}

interface OverpassEl {
  type: 'node' | 'way' | 'relation';
  id:   number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OverpassResponse { elements?: OverpassEl[] }

// Stride-sample the geometry so the Overpass `around` clause stays small.
// One probe roughly every ~350 m is plenty to catch anything within 120 m
// of the line; we also hard-cap the count so the query never explodes.
function probesFrom(geometry: [number, number][], maxProbes: number): [number, number][] {
  if (geometry.length <= maxProbes) return geometry;
  const step = Math.ceil(geometry.length / maxProbes);
  const out: [number, number][] = [];
  for (let i = 0; i < geometry.length; i += step) out.push(geometry[i]);
  return out;
}

function categorise(tags: Record<string, string>): PoiCategory | null {
  if (tags.amenity === 'drinking_water' || tags.man_made === 'water_tap') return 'water';
  if (tags.amenity === 'fountain' && tags.drinking_water !== 'no')        return 'water';
  if (tags.landuse === 'cemetery' || tags.amenity === 'grave_yard')       return 'water';
  if (tags.shop === 'supermarket')  return 'supermarket';
  if (tags.shop === 'convenience')  return 'convenience';
  if (tags.shop === 'bakery')       return 'bakery';
  return null;
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, RATE_LIMITS.commune, 'route-pois');
  if (limited) return limited;

  let body: { geometry?: [number, number][] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const geometry = body.geometry;
  if (!Array.isArray(geometry) || geometry.length < 2) {
    return NextResponse.json({ pois: [] });
  }

  const probes = probesFrom(geometry, 120);
  // Build the around-coordinate list: "lat,lon,lat,lon,…".
  const coords = probes.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  const RADIUS = 120; // metres from the route line

  const query =
    `[out:json][timeout:25];(` +
    `node(around:${RADIUS},${coords})[amenity=drinking_water];` +
    `node(around:${RADIUS},${coords})[man_made=water_tap];` +
    `node(around:${RADIUS},${coords})[amenity=fountain][drinking_water!=no];` +
    `nwr(around:${RADIUS},${coords})[landuse=cemetery];` +
    `node(around:${RADIUS},${coords})[shop=supermarket];` +
    `way(around:${RADIUS},${coords})[shop=supermarket];` +
    `node(around:${RADIUS},${coords})[shop=convenience];` +
    `node(around:${RADIUS},${coords})[shop=bakery];` +
    `way(around:${RADIUS},${coords})[shop=bakery];` +
    `);out center tags;`;

  let data: OverpassResponse;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) return NextResponse.json({ pois: [] });
    data = await res.json() as OverpassResponse;
  } catch {
    return NextResponse.json({ pois: [] });
  }

  // Categorise + collect coordinates (nodes carry lat/lon, ways/relations
  // carry a `center`). Dedupe near-identical points so a cemetery polygon
  // and its tap don't both show.
  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const cat = categorise(tags);
    if (!cat) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const key = `${cat}:${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pois.push({ cat, name: tags.name ?? null, lat, lng });
  }

  // Cap the payload — a city-edge route can surface hundreds. Keep water
  // first (most safety-critical), then food, bounded per category.
  const CAPS: Record<PoiCategory, number> = { water: 60, supermarket: 30, convenience: 40, bakery: 40 };
  const counts: Record<string, number> = {};
  const capped = pois.filter(p => {
    counts[p.cat] = (counts[p.cat] ?? 0) + 1;
    return counts[p.cat] <= CAPS[p.cat];
  });

  return NextResponse.json(
    { pois: capped },
    { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
  );
}
