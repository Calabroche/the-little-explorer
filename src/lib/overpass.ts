/**
 * Shared Overpass (OpenStreetMap) query helper.
 *
 * The public instances overload constantly, so we RACE all mirrors in parallel
 * and retry each on failure until a shared deadline — the first valid answer
 * wins. FR instance leads (fast + reliable for our area). Never use regional
 * extracts that 200 with zero elements.
 */
const OVERPASS_HOSTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',  // FR, fast + reliable
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

export interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };   // present on ways/relations with `out center`
  tags?: Record<string, string>;
}
export interface OverpassResp { elements?: OverpassElement[] }

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

/** Race every mirror, each retrying on failure until the shared deadline.
 *  Returns null only if every mirror keeps failing for the whole budget. */
export async function runOverpass(query: string, perAttemptMs = 14_000, deadlineMs = 30_000): Promise<OverpassResp | null> {
  const deadline = Date.now() + deadlineMs;
  const tryHost = async (url: string): Promise<OverpassResp> => {
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        return await fetchOverpass(url, query, perAttemptMs);
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 600));
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

/** Element centroid, handling node (lat/lon) vs way/relation (center). */
export function elementLatLng(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}
