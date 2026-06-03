import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, enforceBodySize, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/route-ways — way-type + surface breakdown for a cycling route.
 *
 * How it works:
 *   1. Route the waypoints through OSRM (same bike profile as
 *      /api/route-bike) but ask for `annotations=nodes,distance`. That
 *      gives us, per leg, the ordered list of OSM node ids the route
 *      traverses plus the metres of each segment between them.
 *   2. Ask Overpass for every OSM way that contains those nodes, with its
 *      `highway` + `surface` tags and its own node list.
 *   3. For each route segment (a consecutive pair of route nodes) find the
 *      way that has that pair adjacent → that segment's tags. Sum the
 *      segment metres into way-type and surface buckets.
 *
 * Returns French-labelled buckets sorted by distance, e.g.
 *   { wayTypes: [{key,label,meters}], surfaces: [{key,label,meters}], total_m }
 *
 * Best-effort: if Overpass is down / rate-limits us we return empty
 * buckets (200) so the client can show "indisponible" rather than error.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

interface Bucket { key: string; label: string; meters: number }

// ── OSM tag → French category mappings ──────────────────────────────────────
function wayTypeOf(highway: string | undefined): { key: string; label: string } {
  switch (highway) {
    case 'motorway': case 'motorway_link':
    case 'trunk': case 'trunk_link':
    case 'primary': case 'primary_link':
      return { key: 'route_nationale', label: 'Route nationale' };
    case 'residential': case 'living_street':
      return { key: 'rue', label: 'Rue' };
    case 'cycleway':
      return { key: 'piste_cyclable', label: 'Piste cyclable' };
    case 'track': case 'path': case 'footway': case 'bridleway':
    case 'pedestrian': case 'steps':
      return { key: 'chemin', label: 'Chemin' };
    case undefined:
      return { key: 'inconnu', label: 'Inconnu' };
    default:
      // secondary / tertiary / unclassified / road / service / …
      return { key: 'route', label: 'Route' };
  }
}

function surfaceOf(surface: string | undefined, highway: string | undefined): { key: string; label: string } {
  if (surface === 'asphalt') return { key: 'asphalte', label: 'Asphalte' };
  if (surface && ['paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett', 'cobblestone', 'metal', 'wood'].includes(surface)) {
    return { key: 'revetu', label: 'Revêtu' };
  }
  if (surface && ['unpaved', 'compacted', 'fine_gravel', 'gravel', 'pebblestone', 'ground', 'dirt', 'earth', 'grass', 'sand', 'mud', 'woodchips', 'rock'].includes(surface)) {
    return { key: 'non_pave', label: 'Non pavé' };
  }
  // No surface tag: paved-by-default road types are almost always asphalt;
  // tracks/paths default to unpaved; everything else is unknown.
  if (!surface) {
    if (highway && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service', 'cycleway'].includes(highway)) {
      return { key: 'asphalte', label: 'Asphalte' };
    }
    if (highway && ['track', 'path', 'bridleway'].includes(highway)) {
      return { key: 'non_pave', label: 'Non pavé' };
    }
  }
  return { key: 'inconnu', label: 'Inconnu' };
}

interface OsrmAnnotation { nodes?: number[]; distance?: number[] }
interface OsrmLeg { annotation?: OsrmAnnotation }
interface OsrmRoute { distance: number; legs?: OsrmLeg[] }
interface OsrmResponse { code: string; routes?: OsrmRoute[]; message?: string }

interface OverpassWay { type: string; id: number; nodes?: number[]; tags?: Record<string, string> }
interface OverpassResponse { elements?: OverpassWay[] }

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, RATE_LIMITS.routeBike, 'route-ways');
  if (limited) return limited;
  const tooBig = enforceBodySize(req, 10_000);
  if (tooBig) return tooBig;

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
  for (const [lat, lng] of wp) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
    }
  }

  // ── 1. OSRM with node + distance annotations ──────────────────────────
  const coords = wp.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const osrmUrl = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coords}`
    + `?overview=false&alternatives=false&steps=false&annotations=nodes,distance`;

  let osrm: OsrmResponse;
  try {
    const res = await fetch(osrmUrl, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) return NextResponse.json({ error: `osrm ${res.status}` }, { status: 502 });
    osrm = await res.json() as OsrmResponse;
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
  if (osrm.code !== 'Ok' || !osrm.routes?.length) {
    return NextResponse.json({ error: osrm.message || osrm.code || 'no_route' }, { status: 502 });
  }
  const route = osrm.routes[0];
  const legs = (route.legs ?? []).filter(l => l.annotation?.nodes && l.annotation?.distance);
  if (legs.length === 0) {
    return NextResponse.json({ error: 'no_annotation' }, { status: 502 });
  }

  // Collect every node id we traverse (deduped) for the Overpass query.
  const nodeSet = new Set<number>();
  for (const leg of legs) for (const n of leg.annotation!.nodes!) nodeSet.add(n);
  const nodeIds = Array.from(nodeSet);

  // ── 2. Overpass: ways containing those nodes, with tags + node lists ──
  // Build a node set, then `way(bn)` selects the ways having any of those
  // nodes as members; `out;` returns each way's tags AND its ordered node
  // ids (which we need to map route segments back to ways). NB: `bn` works
  // on an input set — the `way(bn:id,id,…)` inline form is NOT valid.
  const overpassQuery = `[out:json][timeout:25];node(id:${nodeIds.join(',')});way(bn)[highway];out;`;

  let overpass: OverpassResponse;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      // Accept header is required — overpass-api.de 406s requests without it.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(overpassQuery),
    });
    if (!res.ok) {
      // Degrade gracefully — empty buckets, 200, so the UI shows "indisponible".
      return NextResponse.json({ wayTypes: [], surfaces: [], total_m: route.distance, unavailable: true });
    }
    overpass = await res.json() as OverpassResponse;
  } catch {
    return NextResponse.json({ wayTypes: [], surfaces: [], total_m: route.distance, unavailable: true });
  }

  // ── 3. Build an undirected node-pair → tags map from the ways ─────────
  const pairKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const pairTags = new Map<string, { highway?: string; surface?: string }>();
  for (const w of overpass.elements ?? []) {
    if (w.type !== 'way' || !w.nodes || w.nodes.length < 2) continue;
    const tags = { highway: w.tags?.highway, surface: w.tags?.surface };
    for (let k = 0; k < w.nodes.length - 1; k++) {
      pairTags.set(pairKey(w.nodes[k], w.nodes[k + 1]), tags);
    }
  }

  // ── 4. Walk the route segments, bucket metres by way-type + surface ──
  const wayBuckets = new Map<string, Bucket>();
  const surfBuckets = new Map<string, Bucket>();
  const add = (m: Map<string, Bucket>, kl: { key: string; label: string }, meters: number) => {
    const cur = m.get(kl.key) ?? { ...kl, meters: 0 };
    cur.meters += meters;
    m.set(kl.key, cur);
  };

  for (const leg of legs) {
    const nodes = leg.annotation!.nodes!;
    const dist = leg.annotation!.distance!;
    for (let k = 0; k < nodes.length - 1 && k < dist.length; k++) {
      const tags = pairTags.get(pairKey(nodes[k], nodes[k + 1]));
      add(wayBuckets, wayTypeOf(tags?.highway), dist[k]);
      add(surfBuckets, surfaceOf(tags?.surface, tags?.highway), dist[k]);
    }
  }

  const sortDesc = (b: Bucket[]) =>
    b.map(x => ({ ...x, meters: Math.round(x.meters) }))
     .filter(x => x.meters > 0)
     .sort((a, c) => c.meters - a.meters);

  return NextResponse.json({
    wayTypes: sortDesc(Array.from(wayBuckets.values())),
    surfaces: sortDesc(Array.from(surfBuckets.values())),
    total_m: Math.round(route.distance),
  });
}
