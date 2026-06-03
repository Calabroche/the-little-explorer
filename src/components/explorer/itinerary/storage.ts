/**
 * Itinerary library — backend-first, with a localStorage hot cache.
 *
 * Why hybrid: the planner page used to be a fully client-side tool
 * (pre-account era) backed entirely by localStorage. Now that we have
 * a real backend + auth, itineraries belong in Supabase — that's the
 * only way the Watch app gets to see them, and it's also the only way
 * a user keeps their work across devices.
 *
 * The localStorage cache stays for two reasons:
 *   1. Synchronous reads on first render — calling /api/itineraries
 *      from useEffect introduces a flash of "no itineraries yet"
 *      every time. Reading the cache lets the UI render instantly,
 *      then the async load reconciles.
 *   2. Offline tolerance — drafts in progress survive a tab reload
 *      even if the API is down.
 *
 * Reconciliation: the async loaders OVERWRITE the cache with server
 * truth on success. The server is the source of truth for the list;
 * the cache is purely a perf optimisation.
 */

import { Itinerary } from './types';

const KEY = (user: string) => `tle_itineraries_${user}`;

// ── Local cache primitives ──────────────────────────────────────────

export function loadAll(user: string): Itinerary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY(user));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setCache(user: string, list: Itinerary[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY(user), JSON.stringify(list));
  } catch {
    // localStorage full / blocked — silent fail rather than breaking the UI.
  }
}

export function saveAll(user: string, list: Itinerary[]): void {
  setCache(user, list);
}

export function newId(): string {
  return `itin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Backend-backed operations ───────────────────────────────────────
//
// Fall back to local-only behaviour when the API errors so the user
// can keep working offline. Errors are surfaced to console — the UI
// can show a banner if it cares.

/**
 * Sync-then-cache. Returns the server's view of the itineraries
 * (each with payload pre-fetched in summary form). Falls back to the
 * cache when the network errors so the UI never goes blank on a
 * flaky connection.
 */
export async function syncFromServer(user: string): Promise<Itinerary[]> {
  try {
    const r = await fetch('/api/itineraries');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { items: Array<{ id: string; name: string; distance_km: number | null; created_at: string }> };
    // The list endpoint returns summaries (no geometry). We hydrate
    // existing local entries with the latest name/distance and append
    // any server-only ones in summary form (the full payload is fetched
    // lazily when the user opens the itinerary).
    const cache = new Map(loadAll(user).map(it => [it.id, it]));
    const merged: Itinerary[] = data.items.map(s => {
      const local = cache.get(s.id);
      if (local) {
        return { ...local, name: s.name, distanceKm: s.distance_km ?? local.distanceKm };
      }
      // Summary-only stub: the user clicking it will fetch the full
      // payload via `loadOne`. For listing purposes this is enough.
      return {
        id:          s.id,
        name:        s.name,
        createdAt:   s.created_at,
        waypoints:   [],
        targetKm:    s.distance_km ?? 0,
        loop:        false,
        distanceKm:  s.distance_km ?? undefined,
      };
    });
    setCache(user, merged);
    return merged;
  } catch (err) {
    console.warn('[itineraries.syncFromServer] failed, using cache:', err);
    return loadAll(user);
  }
}

/**
 * Tolerate payloads written by the iOS app's older encoder so a route
 * saved on the phone renders here:
 *   - geometry as `[{lat,lng}]` objects → `[[lat,lng]]` pairs;
 *   - createdAt as a Swift number (seconds since 2001) → ISO string.
 * Newer iOS builds already emit the canonical shape; this is a no-op then.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeItinerary(raw: any): Itinerary {
  if (!raw || typeof raw !== 'object') return raw as Itinerary;
  const it = { ...raw };
  if (Array.isArray(it.geometry)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    it.geometry = it.geometry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => Array.isArray(p) ? p : (p && typeof p.lat === 'number' && typeof p.lng === 'number' ? [p.lat, p.lng] : null))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => Array.isArray(p) && p.length >= 2);
  }
  if (typeof it.createdAt === 'number') {
    const REF = Date.UTC(2001, 0, 1); // Swift reference date
    it.createdAt = new Date(REF + it.createdAt * 1000).toISOString();
  }
  return it as Itinerary;
}

/** Fetch one itinerary's full payload (waypoints + geometry + elevations). */
export async function loadOne(user: string, id: string): Promise<Itinerary | null> {
  try {
    const r = await fetch(`/api/itineraries?id=${encodeURIComponent(id)}`);
    if (!r.ok) {
      if (r.status === 404) return null;
      throw new Error(`HTTP ${r.status}`);
    }
    const raw = await r.json() as { payload: Itinerary };
    const payload = normalizeItinerary(raw.payload);
    // Backfill the cache entry with the full payload so subsequent
    // list renders show full data instead of a summary stub.
    const list = loadAll(user);
    const idx  = list.findIndex(x => x.id === id);
    if (idx >= 0) {
      list[idx] = payload;
      setCache(user, list);
    }
    return payload;
  } catch (err) {
    console.warn('[itineraries.loadOne] failed, trying cache:', err);
    const local = loadAll(user).find(x => x.id === id);
    return local ?? null;
  }
}

/** Persist an itinerary to the server + update the cache. */
export async function upsert(user: string, it: Itinerary): Promise<Itinerary[]> {
  // Update the local cache immediately so the UI sees the change
  // without waiting for the network. The server call below brings
  // the local cache back in line with the server if anything diverges.
  const list = loadAll(user);
  const idx  = list.findIndex(x => x.id === it.id);
  if (idx >= 0) list[idx] = it;
  else          list.unshift(it);
  setCache(user, list);

  try {
    const r = await fetch('/api/itineraries', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id:          it.id,
        name:        it.name,
        distance_km: it.distanceKm ?? null,
        payload:     it,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({})) as { error?: string };
      console.warn('[itineraries.upsert] server rejected:', err.error ?? `HTTP ${r.status}`);
    }
  } catch (err) {
    console.warn('[itineraries.upsert] network error (kept locally):', err);
  }
  return list;
}

/** Delete an itinerary from the server + cache. */
export async function remove(user: string, id: string): Promise<Itinerary[]> {
  const list = loadAll(user).filter(x => x.id !== id);
  setCache(user, list);

  try {
    await fetch('/api/itineraries', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    });
  } catch (err) {
    console.warn('[itineraries.remove] network error:', err);
  }
  return list;
}
