'use client';

import { useState, useEffect, useRef, useCallback, useMemo, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import type { DivIcon } from 'leaflet';
import { tokens } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { useT } from '@/i18n';
import { UserId } from '../Sidebar';
import { Waypoint, Itinerary } from '../itinerary/types';
import { loadAll, upsert, remove, newId, syncFromServer, loadOne } from '../itinerary/storage';
import { downsampleByDistance, buildElevationSeries, ascentDescent, haversineM } from '../itinerary/elevation';
import { ElevationChart } from '../itinerary/ElevationChart';
import { buildGpx, downloadGpx, slugify as gpxSlug } from '../itinerary/gpx';

// Leaflet pulls in `window` at import time → ssr:false.
const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(m => m.Polyline),     { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false });
const Marker       = dynamic(() => import('react-leaflet').then(m => m.Marker),       { ssr: false });
const Tooltip      = dynamic(() => import('react-leaflet').then(m => m.Tooltip),      { ssr: false });
const MapClickHandler = dynamic(() => import('../itinerary/MapClickHandler').then(m => m.MapClickHandler), { ssr: false });
const ClickPopupTracker = dynamic(() => import('../itinerary/MapClickHandler').then(m => m.ClickPopupTracker), { ssr: false });
const MapAutoResize = dynamic(() => import('../itinerary/MapClickHandler').then(m => m.MapAutoResize), { ssr: false });
const FitBounds    = dynamic(() => import('../itinerary/FitBounds').then(m => m.FitBounds), { ssr: false });
const BasemapTiles = dynamic(() => import('../MapBasemap').then(m => m.BasemapTiles), { ssr: false });
import { useBasemap, BasemapToggle } from '../MapBasemap';
import { useZoomPercent, ZoomPercentPill } from '../MapZoomControl';
import { ColsPicker, Col, colCode, useNearbyCols } from '../ColsPicker';

interface Props {
  user: UserId;
  // When rendered inside another page (e.g. PlannerPage as a tab),
  // we skip the page-level wrapper (padding/scroll) and the
  // SectionTag/headline — the host page handles those.
  embedded?: boolean;
  // Routing profile: 'cycling' (default) or 'running' (OSRM foot profile,
  // allows footpaths). Drives /api/route-bike's `profile`.
  sport?: 'cycling' | 'running';
}

// ── Hooks ───────────────────────────────────────────────────────────────────

// Mirror the activity-detail map's dark-mode behaviour: the rest of the
// site toggles a `data-dark` attr on <html> when the user flips dark
// mode, so we observe it and swap tile layers in lockstep.
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.hasAttribute('data-dark'));
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.hasAttribute('data-dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Village search input ────────────────────────────────────────────────────

function VillageSearch({ onPick, placeholder }: {
  onPick: (w: Waypoint) => void;
  placeholder: string;
}) {
  const [q, setQ]                 = useState('');
  const [results, setResults]     = useState<Waypoint[]>([]);
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const debounceRef               = useRef<NodeJS.Timeout | null>(null);
  const containerRef              = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/commune-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) { setResults([]); return; }
        const data: Waypoint[] = await res.json();
        setResults(data);
        setOpen(true);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 14px',
          fontFamily: "'Space Grotesk'", fontSize: 13,
          background: tokens.cream, color: tokens.ink,
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 4,
          outline: 'none',
        }}
      />
      {loading && (
        <span style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.1em',
        }}>…</span>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 4, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
        }}>
          {results.map((r, i) => {
            // BAN can return multiple results that share the same INSEE
            // citycode (e.g. several streets in one commune), so we
            // include the index to keep React keys unique.
            const isPrecise = r.kind === 'housenumber' || r.kind === 'street';
            const icon = r.kind === 'housenumber' ? '⌂'
                       : r.kind === 'street'      ? '═'
                       : r.kind === 'locality'    ? '◦'
                       :                            '◉';
            return (
            <button
              key={`${r.code}-${i}-${r.label ?? r.name}`}
              onClick={() => { onPick(r); setQ(''); setResults([]); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 12px', textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink,
                borderBottom: `1px solid ${tokens.creamBorder}`,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = tokens.creamDark)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13, color: isPrecise ? tokens.terra : tokens.inkLight, width: 14, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
                <span style={{ display: 'block', fontWeight: isPrecise ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.name}
                </span>
                {isPrecise && (r.city || r.postal) && (
                  <span style={{ display: 'block', fontSize: 10, color: tokens.inkLight, letterSpacing: '0.04em', marginTop: 1 }}>
                    {r.city ?? ''}{r.postal ? ` · ${r.postal}` : ''}
                  </span>
                )}
              </span>
              {!isPrecise && (
                <span style={{ fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', flexShrink: 0 }}>{r.postal}</span>
              )}
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

// Format a number with the locale's decimal separator (74.8 → "74,8" in FR).
function fmtNum(n: number, digits: number, lang: string): string {
  return n.toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

// Komoot-style difficulty from distance + climbing (mirrors the iOS detail
// view): effort = km + D+/8 → Facile (<50) / Modéré (<150) / Difficile.
function routeDifficulty(distanceKm: number, ascent: number): { key: 'diffEasy' | 'diffModerate' | 'diffHard'; bg: string; fg: string } {
  const effort = distanceKm + ascent / 8;
  if (effort < 50)  return { key: 'diffEasy',     bg: '#E4EFDD', fg: '#4F7A43' };
  if (effort < 150) return { key: 'diffModerate', bg: '#F3E0CC', fg: '#9C4E1E' };
  return { key: 'diffHard', bg: '#3A2A22', fg: '#FFFFFF' };
}

// Classify an average cycling speed into a pace band (label only — the value
// is shown alongside). Tuned so ~19 km/h reads as "Modéré".
function speedBand(kmh: number): 'speedCalm' | 'speedModerate' | 'speedBrisk' | 'speedFast' {
  if (kmh < 16) return 'speedCalm';
  if (kmh < 21) return 'speedModerate';
  if (kmh < 26) return 'speedBrisk';
  return 'speedFast';
}

// ── Way-type / surface breakdown (mirrors the iOS detail view) ──────────────
interface WayBucket { key: string; label: string; meters: number }
const WAY_COLORS: Record<string, string> = {
  route:           '#99aabd',
  rue:             '#c4ccd6',
  piste_cyclable:  '#4fa493',
  route_nationale: '#e3b33d',
  chemin:          '#d6dbe2',
  asphalte:        '#99aabd',
  revetu:          '#e8e8e8',
  non_pave:        '#cfc4a8',
  inconnu:         '#333333',
};
function fmtMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`;
}

// ── Resupply points (water / food) along the route ──────────────────────────
type PoiCategory = 'water' | 'supermarket' | 'convenience' | 'bakery';
interface Poi { cat: PoiCategory; name: string | null; lat: number; lng: number }
const POI_META: Record<PoiCategory, { color: string; icon: string; label: string }> = {
  water:       { color: '#3DA5D9', icon: '💧', label: 'Eau' },
  supermarket: { color: '#4F9A54', icon: '🛒', label: 'Supermarché' },
  convenience: { color: '#2FA39A', icon: '🏪', label: 'Supérette' },
  bakery:      { color: '#D98E3D', icon: '🥐', label: 'Boulangerie' },
};
const POI_ORDER: PoiCategory[] = ['water', 'supermarket', 'convenience', 'bakery'];

// Resample an elevation series onto a 100 m grid (the elevation API caps us
// at 100 points, so we interpolate for display — same as the iOS app). The
// geometry index is interpolated too so the hover marker stays aligned.
function densifyTo100m(
  series: { km: number; ele: number }[],
  indices: number[],
): { series: { km: number; ele: number }[]; indices: number[] } {
  if (series.length < 2 || indices.length !== series.length) return { series, indices };
  const total = series[series.length - 1].km;
  if (total <= 0.1) return { series, indices };
  const step = 0.1;
  const count = Math.min(1500, Math.floor(total / step) + 1);
  const outS: { km: number; ele: number }[] = [];
  const outI: number[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const k = Math.min(total, i * step);
    while (j < series.length - 2 && series[j + 1].km < k) j++;
    const a = series[j];
    const b = series[Math.min(j + 1, series.length - 1)];
    const t = b.km > a.km ? (k - a.km) / (b.km - a.km) : 0;
    outS.push({ km: +k.toFixed(3), ele: Math.round(a.ele + (b.ele - a.ele) * t) });
    const ia = indices[j];
    const ib = indices[Math.min(j + 1, indices.length - 1)];
    outI.push(Math.round(ia + (ib - ia) * t));
  }
  return { series: outS, indices: outI };
}

// Waypoints actually sent to OSRM. When `loop` is on we append the
// start village as the final stop so the route ends where it begins.
function effectiveWaypoints(wp: Waypoint[], loop: boolean): Waypoint[] {
  if (!loop || wp.length < 2) return wp;
  return [...wp, wp[0]];
}

// ── Auto-extend: insert a detour village to hit the target distance ────────

async function findDetour(
  waypoints: Waypoint[],
  targetKm: number,
  distanceKm: number,
  loop: boolean,
): Promise<{ waypoint: Waypoint; insertAt: number } | null> {
  const extraKm = targetKm - distanceKm;
  if (extraKm < 3) return null;
  if (waypoints.length < (loop ? 1 : 2)) return null;

  // Effective leg list — same order OSRM saw, including loop closure.
  const eff = effectiveWaypoints(waypoints, loop);
  let bestI = 0, bestD = 0;
  for (let i = 0; i < eff.length - 1; i++) {
    const d = haversineM([eff[i].lat, eff[i].lng], [eff[i + 1].lat, eff[i + 1].lng]);
    if (d > bestD) { bestD = d; bestI = i; }
  }
  const a = eff[bestI];
  const b = eff[bestI + 1];
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lng + b.lng) / 2;

  // Perpendicular direction (rotate the leg vector 90°), normalised.
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const perpLat = -dLng;
  const perpLng =  dLat;
  const norm = Math.hypot(perpLat, perpLng) || 1;

  // A detour adds ≈ 2× the offset distance to the route (out and back).
  // Cap at 12 km so we don't drag the route into the next region.
  const offsetKm = Math.max(3, Math.min(12, extraKm / 4));
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  // INSEE codes already in the itinerary so we never re-suggest one.
  const exclude = waypoints.map(w => w.code).join(',');

  // Try the perpendicular shift, then the opposite side if that fails.
  const candidates: [number, number][] = [
    [
      midLat + (perpLat / norm) * (offsetKm / 111),
      midLng + (perpLng / norm) * (offsetKm / (111 * cosLat || 1)),
    ],
    [
      midLat - (perpLat / norm) * (offsetKm / 111),
      midLng - (perpLng / norm) * (offsetKm / (111 * cosLat || 1)),
    ],
  ];
  for (const [tLat, tLng] of candidates) {
    try {
      const res = await fetch(`/api/commune-search?lat=${tLat}&lng=${tLng}&exclude=${exclude}`);
      if (!res.ok) continue;
      const arr: Waypoint[] = await res.json();
      if (arr.length > 0) {
        // Insert position in the *user-visible* waypoints array.
        // If we picked the loop-closure leg, insert before the implicit closure
        // (i.e. at the end of the user list).
        const insertAt = bestI === waypoints.length - 1 && loop
          ? waypoints.length
          : bestI + 1;
        return { waypoint: arr[0], insertAt };
      }
    } catch { /* try next */ }
  }
  return null;
}

// ── Main component ──────────────────────────────────────────────────────────

export function ItineraryPage({ user, embedded, sport = 'cycling' }: Props) {
  const { t, lang } = useT();
  const en = lang === 'en';
  const isMobile = useIsMobile();
  // Lets the user collapse the (potentially long) stops list to free up
  // vertical space while keeping the search + everything below in reach.
  const [stopsCollapsed, setStopsCollapsed] = useState(false);
  // User-chosen cruising speed (km/h). When set it overrides the routing
  // engine's average and drives the estimated time (time = distance / speed).
  // null → fall back to the OSRM-derived duration.
  const [speedOverride, setSpeedOverride] = useState<number | null>(null);
  const dark = useDarkMode();

  const [waypoints, setWaypoints]     = useState<Waypoint[]>([]);
  const [targetKm, setTargetKm]       = useState<number>(50);
  const [loop, setLoop]               = useState<boolean>(false);
  const [name, setName]               = useState<string>('');
  const [activeId, setActiveId]       = useState<string | null>(null);

  const [geometry, setGeometry]       = useState<[number, number][] | null>(null);
  const [distanceM, setDistanceM]     = useState<number | null>(null);
  const [durationS, setDurationS]     = useState<number | null>(null);
  // Turn-by-turn maneuvers from OSRM — Phase E.2. Stored alongside
  // geometry so saved itineraries carry voice-nav cues without
  // needing a second routing call.
  const [steps, setSteps]             = useState<import('../itinerary/types').NavStep[] | null>(null);
  const [routing, setRouting]         = useState(false);
  const [routeError, setRouteError]   = useState<string | null>(null);
  const [extending, setExtending]     = useState(false);

  // Elevation cache for the current geometry.
  const [elevSeries, setElevSeries]   = useState<{ km: number; ele: number }[]>([]);
  const [elevations, setElevations]   = useState<number[] | null>(null);
  const [elevIndices, setElevIndices] = useState<number[] | null>(null);
  const [ascent, setAscent]           = useState(0);
  const [descent, setDescent]         = useState(0);
  const [eleLoading, setEleLoading]   = useState(false);
  // When the user hovers the elevation chart, this holds the index in
  // the elevSeries array; the map then renders a synced marker at the
  // matching geometry point so you can see where on the route you are.
  const [hoverEleIdx, setHoverEleIdx] = useState<number | null>(null);

  const [library, setLibrary]         = useState<Itinerary[]>([]);

  // ── Click-to-add (drop a precise point on the map) ───────────────────────
  // When the user clicks the map a confirmation popup opens at that exact
  // spot. `clickPoint` holds the raw clicked coordinates; `clickInfo` is the
  // reverse-geocoded label (street / commune) shown in the popup once it
  // resolves. Confirming appends the point to the route; the ✕ dismisses it.
  const [clickPoint, setClickPoint]   = useState<{ lat: number; lng: number } | null>(null);
  const [clickPixel, setClickPixel]   = useState<{ x: number; y: number } | null>(null);
  const [clickInfo, setClickInfo]     = useState<{ name: string; city?: string; postal?: string; code?: string } | null>(null);
  const [clickLoading, setClickLoading] = useState(false);

  // Way-type + surface breakdown (OSM-enriched, via /api/route-ways).
  const [wayAnalysis, setWayAnalysis] = useState<{ wayTypes: WayBucket[]; surfaces: WayBucket[] } | null>(null);
  const [wayLoading, setWayLoading]   = useState(false);

  // Resupply points (water / food) along the route — OSM via /api/route-pois.
  // Off by default (one Overpass call per toggle); fetched lazily on enable.
  const [showPois, setShowPois]   = useState(false);
  const [pois, setPois]           = useState<Poi[]>([]);
  const [poisLoading, setPoisLoading] = useState(false);
  const poiFetchedFor = useRef<string>('');

  // Render the cache instantly, then reconcile with the server (so a
  // freshly-logged-in user pulls their itineraries down without
  // needing a manual refresh).
  useEffect(() => {
    setLibrary(loadAll(user));
    void syncFromServer(user).then(setLibrary).catch(() => { /* keep cache */ });
  }, [user]);

  // ── Waypoint manipulation ────────────────────────────────────────────────
  const addWaypoint  = (w: Waypoint) => setWaypoints(prev =>
    prev.some(p => p.code === w.code) ? prev : [...prev, w]
  );
  const removeWaypoint = (idx: number) => setWaypoints(prev => prev.filter((_, i) => i !== idx));

  // Toggle a nearby col in/out of the route (added as a waypoint).
  const toggleCol = (col: Col) => {
    const code = colCode(col);
    setWaypoints(prev => {
      const idx = prev.findIndex(w => w.code === code);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, {
        name: col.name, code, lat: col.lat, lng: col.lng,
        label: col.ele != null ? `${col.name} · ${col.ele} m` : col.name,
        kind: 'locality' as const,
      }];
    });
  };
  // Set of waypoint codes — lets ColsPicker show which cols are selected.
  const selectedColCodes = useMemo(() => new Set(waypoints.map(w => w.code)), [waypoints]);

  // Nearby cols (cycling only) — fetched once here, then shown BOTH as always-on
  // markers on the map and as the picker list below. The departure (waypoint #1)
  // is the search centre.
  const [colRadiusKm, setColRadiusKm] = useState(25);
  const colCenter = useMemo<[number, number] | null>(
    () => (sport === 'cycling' && waypoints[0]) ? [waypoints[0].lat, waypoints[0].lng] : null,
    [sport, waypoints],
  );
  const { cols: nearbyCols, loading: colsLoading, errored: colsErrored, retry: colsRetry } = useNearbyCols(colCenter, colRadiusKm);

  // Small ⛰/🗻 emoji pins for the col markers, built client-side (leaflet needs
  // `window`). Selected pins get a terra badge so they stand out.
  const [colIcons, setColIcons] = useState<Record<'col' | 'colSel' | 'sommet' | 'sommetSel', DivIcon> | null>(null);
  useEffect(() => {
    let active = true;
    import('leaflet').then(mod => {
      const L = mod.default ?? mod;
      const make = (emoji: string, sel: boolean) => L.divIcon({
        className: 'tle-col-pin',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:13px;line-height:1;background:${sel ? tokens.terra : 'rgba(255,255,255,0.92)'};border:1.5px solid ${sel ? '#fff' : 'rgba(0,0,0,0.3)'};box-shadow:0 1px 3px rgba(0,0,0,0.45);cursor:pointer;">${emoji}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11], tooltipAnchor: [0, -4],
      });
      if (active) setColIcons({
        col: make('⛰️', false), colSel: make('⛰️', true),
        sommet: make('🗻', false), sommetSel: make('🗻', true),
      });
    });
    return () => { active = false; };
  }, []);

  // ── Click-to-add a precise map point ─────────────────────────────────────
  // Clicking the map opens the confirmation popup at the exact spot and kicks
  // off a reverse-geocode so the popup can name the street / commune. We keep
  // the raw clicked coordinates (not the snapped BAN result) so the route
  // passes through precisely where the user clicked.
  const handleMapClick = useCallback((lat: number, lng: number) => {
    setClickPoint({ lat, lng });
    setClickInfo(null);
    setClickLoading(true);
    fetch(`/api/commune-search?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`)
      .then(r => (r.ok ? r.json() : []))
      .then((arr: Waypoint[]) => {
        const hit = Array.isArray(arr) ? arr[0] : null;
        if (hit) setClickInfo({ name: hit.name, city: hit.city, postal: hit.postal, code: hit.code });
        else setClickInfo({ name: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
      })
      .catch(() => setClickInfo({ name: `${lat.toFixed(4)}, ${lng.toFixed(4)}` }))
      .finally(() => setClickLoading(false));
  }, []);

  // Append the pending clicked point to the end of the route. We mint a unique
  // synthetic `code` (`pt:lat,lng`) so two precise points in the same commune
  // don't collide with the INSEE-code dedup used for searched villages.
  const confirmClickPoint = () => {
    if (!clickPoint) return;
    const { lat, lng } = clickPoint;
    const w: Waypoint = {
      name:  clickInfo?.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      code:  `pt:${lat.toFixed(5)},${lng.toFixed(5)}`,
      lat, lng,
      city:  clickInfo?.city,
      postal: clickInfo?.postal,
      label: clickInfo?.city && clickInfo.name !== clickInfo.city
               ? `${clickInfo.name}, ${clickInfo.city}` : clickInfo?.name,
      kind:  'locality',
    };
    setWaypoints(prev => [...prev, w]);
    setClickPoint(null);
    setClickInfo(null);
  };
  const moveWaypoint   = (idx: number, dir: -1 | 1) => setWaypoints(prev => {
    const next = [...prev];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const clearAll = () => {
    setWaypoints([]); setGeometry(null); setDistanceM(null); setDurationS(null); setSteps(null);
    setName(''); setActiveId(null); setRouteError(null);
    setElevSeries([]); setElevations(null); setElevIndices(null); setAscent(0); setDescent(0);
    setClickPoint(null); setClickInfo(null); setSpeedOverride(null);
  };

  // ── Routing ──────────────────────────────────────────────────────────────
  // When we LOAD a saved route we already have its geometry (and, for a GPX
  // import, only 1-2 stored waypoints that can't reproduce the real track).
  // These flags skip the next auto-recompute / elevation re-fetch so loading
  // a route doesn't erase its geometry or its cached profile.
  const skipRecomputeRef = useRef(false);
  const skipElevRef = useRef(false);
  const computeRoute = useCallback(async () => {
    const eff = effectiveWaypoints(waypoints, loop);
    if (eff.length < 2) {
      setGeometry(null); setDistanceM(null); setDurationS(null); setRouteError(null);
      setElevSeries([]); setElevations(null); setElevIndices(null);
      return;
    }
    setRouting(true); setRouteError(null);
    try {
      const res = await fetch('/api/route-bike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waypoints: eff.map(w => [w.lat, w.lng]),
          // Always request turn-by-turn steps so the Watch can do
          // voice nav (Phase E.2). 10-25 KB extra payload is fine.
          steps: true,
          // OSRM foot profile for running so footpaths are allowed.
          profile: sport === 'running' ? 'foot' : 'bike',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setGeometry(data.geometry);
      setDistanceM(data.distance_m);
      setDurationS(data.duration_s);
      setSteps(data.steps ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRouteError(msg);
      setGeometry(null); setDistanceM(null); setDurationS(null);
    } finally {
      setRouting(false);
    }
  }, [waypoints, loop, sport]);

  useEffect(() => {
    if (skipRecomputeRef.current) {
      skipRecomputeRef.current = false;
      return; // just loaded a saved route — keep its geometry
    }
    const id = setTimeout(computeRoute, 300);
    return () => clearTimeout(id);
  }, [computeRoute]);

  // ── Elevation: fetch a downsampled profile each time the geometry changes
  useEffect(() => {
    if (skipElevRef.current) {
      skipElevRef.current = false;
      return; // just loaded a saved route — keep its cached profile
    }
    let cancelled = false;
    if (!geometry || geometry.length < 2) {
      setElevSeries([]); setElevations(null); setElevIndices(null);
      setAscent(0); setDescent(0);
      return;
    }
    const { points, indices } = downsampleByDistance(geometry, 80);
    setEleLoading(true);
    fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { elevations: number[] }) => {
        if (cancelled) return;
        const series = buildElevationSeries(geometry, indices, data.elevations);
        // D+/D− from the raw samples (interpolation would smooth out climbing).
        const { ascent, descent } = ascentDescent(data.elevations);
        // Densify to a 100 m grid for display + hover (series and indices stay
        // aligned; we persist the dense pair so reloads keep the resolution).
        const dense = densifyTo100m(series, indices);
        setElevSeries(dense.series);
        setElevIndices(dense.indices);
        setElevations(dense.series.map(p => p.ele));
        setAscent(ascent);
        setDescent(descent);
      })
      .catch(() => {
        if (cancelled) return;
        // Elevation is decorative — silent fail keeps the rest of the
        // page usable even when opentopodata is rate-limiting us.
        setElevSeries([]); setElevations(null); setElevIndices(null);
        setAscent(0); setDescent(0);
      })
      .finally(() => { if (!cancelled) setEleLoading(false); });
    return () => { cancelled = true; };
  }, [geometry]);

  // ── Way types + surfaces: OSM breakdown of the route ──────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!geometry || geometry.length < 2) { setWayAnalysis(null); return; }
    // Sample ≤24 points along the route (OSRM waypoint cap) so the analysis
    // follows the actual path — same approach as the iOS app.
    const n = Math.min(24, geometry.length);
    const stepIdx = (geometry.length - 1) / (n - 1);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      pts.push(geometry[Math.min(geometry.length - 1, Math.round(i * stepIdx))]);
    }
    setWayLoading(true);
    fetch('/api/route-ways', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints: pts }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { wayTypes?: WayBucket[]; surfaces?: WayBucket[] }) => {
        if (!cancelled) setWayAnalysis({ wayTypes: data.wayTypes ?? [], surfaces: data.surfaces ?? [] });
      })
      .catch(() => { if (!cancelled) setWayAnalysis(null); })
      .finally(() => { if (!cancelled) setWayLoading(false); });
    return () => { cancelled = true; };
  }, [geometry]);

  // ── Resupply points: fetch water/food POIs once the toggle is on ──────────
  // Lazy: only hits Overpass when the rider asks for it, and only re-fetches
  // when the route geometry actually changes (keyed by point count + ends).
  useEffect(() => {
    if (!showPois || !geometry || geometry.length < 2) return;
    const key = `${geometry.length}:${geometry[0].join(',')}:${geometry[geometry.length - 1].join(',')}`;
    if (poiFetchedFor.current === key) return;
    poiFetchedFor.current = key;
    let cancelled = false;
    setPoisLoading(true);
    fetch('/api/route-pois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geometry }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { pois?: Poi[] }) => { if (!cancelled) setPois(data.pois ?? []); })
      .catch(() => { if (!cancelled) setPois([]); })
      .finally(() => { if (!cancelled) setPoisLoading(false); });
    return () => { cancelled = true; };
  }, [showPois, geometry]);

  // Drop stale POIs (and reset the fetch guard) whenever the route changes.
  useEffect(() => { setPois([]); poiFetchedFor.current = ''; }, [geometry]);

  const poiCounts = useMemo(() => {
    const c: Record<PoiCategory, number> = { water: 0, supermarket: 0, convenience: 0, bakery: 0 };
    for (const p of pois) c[p.cat]++;
    return c;
  }, [pois]);

  // ── Auto-extend ──────────────────────────────────────────────────────────
  const handleAutoExtend = async () => {
    if (distanceM == null) return;
    const distanceKm = distanceM / 1000;
    if (targetKm - distanceKm < 3) return;
    setExtending(true);
    try {
      const found = await findDetour(waypoints, targetKm, distanceKm, loop);
      if (found) {
        setWaypoints(prev => {
          const next = [...prev];
          next.splice(found.insertAt, 0, found.waypoint);
          return next;
        });
      }
    } finally {
      setExtending(false);
    }
  };

  // ── Save / load / delete ─────────────────────────────────────────────────
  const handleSave = () => {
    if (waypoints.length < 2) return;
    const it: Itinerary = {
      id:          activeId ?? newId(),
      name:        name.trim() || `${waypoints[0].name} → ${waypoints[waypoints.length - 1].name}`,
      createdAt:   new Date().toISOString(),
      waypoints,
      targetKm,
      loop,
      distanceKm:  distanceM != null ? +(distanceM / 1000).toFixed(1) : undefined,
      durationMin: durationS != null ? Math.round(durationS / 60)     : undefined,
      geometry:    geometry ?? undefined,
      steps:       steps ?? undefined,
      elevSampleIndices: elevIndices ?? undefined,
      elevations:        elevations ?? undefined,
      totalAscent:       ascent || undefined,
      totalDescent:      descent || undefined,
    };
    // upsert mutates the local cache synchronously before the network
    // round-trip, so reading loadAll() gives us the latest immediately.
    void upsert(user, it);
    setLibrary(loadAll(user));
    setActiveId(it.id);
    setName(it.name);
  };

  const handleLoad = async (it: Itinerary) => {
    // Server-only itineraries (e.g. saved on the iOS app) arrive in the
    // library as summary stubs — no geometry/waypoints. Fetch the full
    // payload before loading, otherwise clicking "opens" an empty route.
    let full = it;
    if (!it.geometry || (it.waypoints?.length ?? 0) === 0) {
      const fetched = await loadOne(user, it.id);
      if (fetched) full = fetched;
    }
    // Preserve the loaded geometry/profile — block the change-driven
    // re-route and elevation re-fetch that would otherwise overwrite them.
    const hasGeom = !!(full.geometry && full.geometry.length >= 2);
    skipRecomputeRef.current = hasGeom;
    skipElevRef.current = hasGeom && !!(full.elevSampleIndices && full.elevations);
    setActiveId(full.id);
    setName(full.name);
    setWaypoints(full.waypoints);
    setTargetKm(full.targetKm);
    setLoop(!!full.loop);
    setGeometry(full.geometry ?? null);
    setDistanceM(full.distanceKm != null ? full.distanceKm * 1000 : null);
    setDurationS(full.durationMin != null ? full.durationMin * 60 : null);
    setRouteError(null);
    // Restore elevation cache if present — saves an opentopodata call.
    if (full.geometry && full.elevSampleIndices && full.elevations) {
      const series = buildElevationSeries(full.geometry, full.elevSampleIndices, full.elevations);
      const dense = densifyTo100m(series, full.elevSampleIndices);
      setElevSeries(dense.series);
      setElevIndices(dense.indices);
      setElevations(dense.series.map(p => p.ele));
      setAscent(full.totalAscent ?? 0);
      setDescent(full.totalDescent ?? 0);
    } else {
      setElevSeries([]); setElevations(null); setElevIndices(null); setAscent(0); setDescent(0);
    }
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t('itinerary.confirmDelete'))) return;
    void remove(user, id);
    setLibrary(loadAll(user));
    if (activeId === id) clearAll();
  };

  // ── Start navigation: auto-save the itinerary (so /navigate/<id> can
  // find it on reload) and jump to the full-screen turn-by-turn view.
  const handleStartNavigation = () => {
    if (waypoints.length < 2 || !geometry) return;
    let id = activeId;
    if (!id) {
      const it: Itinerary = {
        id:          newId(),
        name:        name.trim() || `${waypoints[0].name} → ${waypoints[waypoints.length - 1].name}`,
        createdAt:   new Date().toISOString(),
        waypoints,
        targetKm,
        loop,
        distanceKm:  distanceM != null ? +(distanceM / 1000).toFixed(1) : undefined,
        durationMin: durationS != null ? Math.round(durationS / 60)     : undefined,
        geometry,
        elevSampleIndices: elevIndices ?? undefined,
        elevations:        elevations ?? undefined,
        totalAscent:       ascent || undefined,
        totalDescent:      descent || undefined,
      };
      void upsert(user, it);
      id = it.id;
      setActiveId(id);
      setLibrary(loadAll(user));
    }
    window.location.href = `/navigate/${id}`;
  };

  // ── GPX export ───────────────────────────────────────────────────────────
  const handleExportGpx = () => {
    if (!geometry || geometry.length < 2 || waypoints.length < 1) return;
    // Interpolate elevations to per-trkpt: only fill if we have the
    // downsampled cache; otherwise skip <ele> tags.
    let perPointElev: number[] | undefined;
    if (elevations && elevIndices && elevations.length === elevIndices.length) {
      perPointElev = new Array(geometry.length).fill(0);
      for (let s = 0; s < elevIndices.length - 1; s++) {
        const i0 = elevIndices[s];
        const i1 = elevIndices[s + 1];
        const e0 = elevations[s];
        const e1 = elevations[s + 1];
        for (let i = i0; i <= i1; i++) {
          const t = i1 > i0 ? (i - i0) / (i1 - i0) : 0;
          perPointElev[i] = e0 + (e1 - e0) * t;
        }
      }
    }
    const itinName = name.trim() || `${waypoints[0].name} → ${waypoints[waypoints.length - 1].name}`;
    const gpx = buildGpx({
      name:       itinName,
      waypoints,
      polyline:   geometry,
      elevations: perPointElev,
    });
    downloadGpx(`${gpxSlug(itinName)}.gpx`, gpx);
  };

  // ── Map data ─────────────────────────────────────────────────────────────
  // Default view: shifted slightly NW of Dardilly so the frame
  // covers the bike-friendly Beaujolais piedmont (Chazay, Lozanne,
  // Chasselay) up top and still has Tassin / Écully visible at the
  // bottom. Centre ~ Lentilly / Dommartin axis. Switches to the
  // first waypoint as soon as the user adds one.
  const mapCenter = useMemo<[number, number]>(() => {
    if (waypoints.length > 0) return [waypoints[0].lat, waypoints[0].lng];
    return [45.85, 4.74];
  }, [waypoints]);

  const polylinePositions = geometry ?? null;

  // Map the elevation-chart hover index back into a [lat, lng] on the
  // map. The chart is sampled at `elevIndices` of the polyline, so step 1
  // is `chartIdx → polyIdx`, step 2 is `polyIdx → geometry[polyIdx]`.
  const hoverPos = useMemo<[number, number] | null>(() => {
    if (hoverEleIdx == null || !elevIndices || !geometry) return null;
    const polyIdx = elevIndices[hoverEleIdx];
    if (polyIdx == null || polyIdx < 0 || polyIdx >= geometry.length) return null;
    return geometry[polyIdx];
  }, [hoverEleIdx, elevIndices, geometry]);

  // Stale-index guard: clear the hover whenever the route changes.
  useEffect(() => { setHoverEleIdx(null); }, [geometry]);

  const distanceKm        = distanceM != null ? +(distanceM / 1000).toFixed(1) : null;
  const deltaKm           = distanceKm != null ? +(distanceKm - targetKm).toFixed(1) : null;
  const deltaPct          = distanceKm != null && targetKm > 0 ? ((distanceKm - targetKm) / targetKm) * 100 : 0;

  // Light mode: CARTO Positron — the "A5" option the user picked to
  //             test. Very neutral, gray palette, sparse labels (good
  //             when the route polyline + waypoint markers should
  //             dominate the map visually).
  // Dark mode:  CARTO Dark Matter base + CARTO labels overlay ("D1"),
  // Basemap (plan/satellite) is now driven by the shared useBasemap hook
  // — the inline tile-URL constants below were retired in favour of
  // <BasemapTiles>. Kept the comment trail in case we need to refactor
  // basemap selection again.
  const [basemap, setBasemap] = useBasemap();
  const [zoomPercent, setZoomPercent] = useZoomPercent();

  // ── Layout ───────────────────────────────────────────────────────────────
  const CARD: CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 20,
  };

  // On desktop the map column is a flex column that stretches to match the
  // (often taller) builder column — so the map card flexes to fill all the
  // leftover height instead of leaving a gap below the elevation profile.
  // `minHeight` keeps it usable when the builder column is short. On mobile
  // the columns stack, so the map keeps a fixed, comfortable height.
  // Map is full-width; height is capped so the stats bar + elevation profile
  // that sit right under it stay visible in the same viewport (no scroll to
  // see the profile). ~400px is reserved below for those two cards.
  const mapCardStyle: CSSProperties = {
    ...CARD, padding: 0, overflow: 'hidden', position: 'relative',
    height: isMobile ? 420 : 'clamp(320px, calc(100vh - 400px), 600px)',
  };
  const mapInnerHeight: number | string = '100%';

  const canExtend = distanceKm != null && targetKm - distanceKm >= 3 && !extending && !routing;
  // A route is "open" once it's been saved/loaded (activeId set). The
  // target-distance section is pointless then — it's already built — so we
  // hide it and collapse the save section into a compact action bar.
  const isOpen = activeId != null;

  // When embedded inside PlannerPage's tab system, the host page
  // already provides the scroll container + section header — so we
  // skip those and let the parent control the chrome.
  const Outer = embedded ? 'div' : 'div';
  const outerStyle: CSSProperties = embedded
    ? {}
    : { flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' };

  return (
    <Outer style={outerStyle}>
      {!embedded && (
        <>
          <SectionTag num={6} title={t('itinerary.tagTitle')} />
          <h1 style={{
            fontFamily: "'Playfair Display'",
            fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink,
            marginBottom: isMobile ? 20 : 32, lineHeight: 1.1,
          }}>
            {t('itinerary.headline')}<br />
            <em style={{ color: tokens.terra, fontStyle: 'italic' }}>{t('itinerary.headlineEm')}</em>
          </h1>
        </>
      )}

      {/* Single column: map (full width) on top, builder underneath.
          `order` puts the map first without moving the JSX blocks. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ─── BUILDER (rendered above the map via order) ────────────────── */}
        <div style={{
          order: 1,
          display: 'grid', gap: 16, alignItems: 'start',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
        }}>
          {/* Step 1: villages */}
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <Label>{t('itinerary.step1')}</Label>
              {waypoints.length > 0 && (
                <button
                  onClick={() => setStopsCollapsed(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: tokens.inkMid,
                  }}
                >
                  <span style={{ color: tokens.terra }}>{waypoints.length}</span>
                  {stopsCollapsed ? `▸ ${t('itinerary.expandList')}` : `▾ ${t('itinerary.collapseList')}`}
                </button>
              )}
            </div>
            <VillageSearch onPick={addWaypoint} placeholder={t('itinerary.searchPlaceholder')} />
            {waypoints.length === 0 && (
              <p style={{ marginTop: 12, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.5 }}>
                {t('itinerary.searchHint')}
              </p>
            )}
            {waypoints.length > 0 && stopsCollapsed && (
              <div style={{
                marginTop: 12, padding: '8px 10px', background: tokens.creamDark, borderRadius: 3,
                fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.4,
              }}>
                {waypoints[0].name} → {waypoints[waypoints.length - 1].name}
                {loop ? ' ↺' : ''}
              </div>
            )}
            {waypoints.length > 0 && !stopsCollapsed && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {waypoints.map((w, i) => (
                  <div key={`${w.code}-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', background: tokens.creamDark, borderRadius: 3,
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: tokens.terra, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: "'Playfair Display'", fontSize: 12, fontWeight: 700,
                      flexShrink: 0,
                    }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {w.name}
                      </div>
                      {/* Street-level waypoints get a 2nd line with the
                          commune (since `name` is the street). For pure
                          municipalities we just show the postal code. */}
                      {(w.city && w.city !== w.name) ? (
                        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {w.city}{w.postal ? ` · ${w.postal}` : ''}
                        </div>
                      ) : w.postal && (
                        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em' }}>
                          {w.postal}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button title={t('itinerary.up')}     onClick={() => moveWaypoint(i, -1)} disabled={i === 0}                       style={iconBtnStyle(i === 0)}>↑</button>
                      <button title={t('itinerary.down')}   onClick={() => moveWaypoint(i, +1)} disabled={i === waypoints.length - 1}    style={iconBtnStyle(i === waypoints.length - 1)}>↓</button>
                      <button title={t('itinerary.remove')} onClick={() => removeWaypoint(i)}   style={iconBtnStyle(false, true)}>✕</button>
                    </div>
                  </div>
                ))}
                {loop && waypoints.length >= 2 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', background: tokens.terraLight, borderRadius: 3,
                    fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.terra, fontWeight: 600,
                    letterSpacing: '0.05em',
                  }}>
                    ↺ {t('itinerary.loopReturn').replace('{name}', waypoints[0].name)}
                  </div>
                )}
                <button onClick={clearAll} style={{
                  marginTop: 4, alignSelf: 'flex-start',
                  fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                  background: 'none', border: 'none', color: tokens.inkLight, cursor: 'pointer',
                }}>
                  {t('itinerary.clearAll')}
                </button>
              </div>
            )}

            {/* Loop toggle — lives with the stops (it's about returning to
                village #1), not with the target distance. While building only. */}
            {!isOpen && waypoints.length >= 1 && (
              <div style={{
                marginTop: 14, display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: loop ? tokens.terraLight : tokens.creamDark,
                borderRadius: 6, border: `1px solid ${loop ? tokens.terra : 'transparent'}`,
                transition: 'all 0.15s',
              }}>
                <button
                  role="switch"
                  aria-checked={loop}
                  onClick={() => setLoop(v => !v)}
                  style={{
                    width: 36, height: 20, padding: 2, flexShrink: 0,
                    background: loop ? tokens.terra : tokens.creamBorder,
                    border: 'none', borderRadius: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: loop ? 'flex-end' : 'flex-start',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 600, color: tokens.ink }}>
                    ↺ {t('itinerary.loop')}
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.04em', marginTop: 1 }}>
                    {t('itinerary.loopHint')}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: target distance — only while building, hidden once a
              route is open (it's already created, the target is moot). */}
          {!isOpen && (
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 10 }}>{t('itinerary.step2')}</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" min={5} max={400} step={5}
                value={targetKm}
                onChange={e => setTargetKm(Math.max(0, Number(e.target.value) || 0))}
                style={{
                  width: 80, padding: '8px 10px',
                  fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink,
                  background: tokens.cream, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4,
                  outline: 'none',
                }}
              />
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight }}>km</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {[30, 50, 80].map(km => (
                  <button key={km} onClick={() => setTargetKm(km)} style={{
                    padding: '4px 10px', fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 500,
                    background: targetKm === km ? tokens.terra : tokens.creamDark,
                    color: targetKm === km ? '#fff' : tokens.inkMid,
                    border: 'none', borderRadius: 12, cursor: 'pointer',
                  }}>{km}</button>
                ))}
              </div>
            </div>

            {distanceKm != null && (
              <div style={{ marginTop: 14, padding: 12, background: tokens.creamDark, borderRadius: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 800, color: tokens.terra }}>
                      {distanceKm}
                    </span>
                    <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>km {t('itinerary.computed')}</span>
                  </span>
                  {ascent > 0 && (
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                      <span style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 800, color: tokens.ink }}>
                        {Math.round(ascent)}
                      </span>
                      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>m D+</span>
                    </span>
                  )}
                  {durationS != null && (
                    <span style={{ marginLeft: 'auto', fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600, color: tokens.inkMid }}>
                      ≈ {formatDuration(durationS)}
                    </span>
                  )}
                </div>
                {deltaKm != null && (
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.5 }}>
                    {Math.abs(deltaPct) < 8 ? (
                      <span style={{ color: tokens.green, fontWeight: 600 }}>
                        ✓ {t('itinerary.onTarget')}
                      </span>
                    ) : deltaKm > 0 ? (
                      <>{t('itinerary.tooLong').replace('{n}', String(Math.abs(deltaKm)))}</>
                    ) : (
                      <>{t('itinerary.tooShort').replace('{n}', String(Math.abs(deltaKm)))}</>
                    )}
                  </div>
                )}
                {canExtend && (
                  <button
                    onClick={handleAutoExtend}
                    disabled={extending}
                    style={{
                      marginTop: 10, width: '100%', padding: '8px 10px',
                      fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                      background: tokens.green, color: '#fff', border: 'none', borderRadius: 3,
                      cursor: extending ? 'wait' : 'pointer', opacity: extending ? 0.6 : 1,
                    }}
                  >
                    {extending ? t('itinerary.extending') : t('itinerary.extendAuto')}
                  </button>
                )}
              </div>
            )}
            {routing && (
              <div style={{ marginTop: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {t('itinerary.computing')}
              </div>
            )}
            {routeError && (
              <div style={{ marginTop: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.terra, lineHeight: 1.5 }}>
                {t('itinerary.routeError')}: {routeError}
              </div>
            )}
          </div>
          )}

          {/* Step 3: save + export. Compact action bar once a route is open. */}
          {isOpen ? (
            <div style={{ ...CARD, padding: 14 }}>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('itinerary.namePlaceholder')}
                style={{
                  width: '100%', padding: '7px 10px', marginBottom: 8,
                  fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 600,
                  background: tokens.cream, color: tokens.ink,
                  border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleSave}
                  disabled={waypoints.length < 2}
                  title={t('itinerary.update')}
                  style={{
                    flex: 1, padding: '9px 10px',
                    fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    background: waypoints.length < 2 ? tokens.creamBorder : tokens.terra,
                    color: '#fff', border: 'none', borderRadius: 4,
                    cursor: waypoints.length < 2 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ↻ {t('itinerary.update')}
                </button>
                <button
                  onClick={handleExportGpx}
                  disabled={!geometry || geometry.length < 2}
                  title={t('itinerary.exportGpx')}
                  style={{
                    width: 44, padding: '9px 0',
                    fontFamily: "'Space Grotesk'", fontSize: 13,
                    background: 'transparent', color: !geometry ? tokens.creamBorder : tokens.ink,
                    border: `1px solid ${!geometry ? tokens.creamBorder : tokens.ink}`, borderRadius: 4,
                    cursor: !geometry ? 'not-allowed' : 'pointer',
                  }}
                >
                  ⤓
                </button>
              </div>
              <button
                onClick={handleStartNavigation}
                disabled={!geometry || geometry.length < 2}
                style={{
                  marginTop: 8, width: '100%', padding: '12px 12px',
                  fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  background: !geometry ? tokens.creamBorder : tokens.green,
                  color: '#fff', border: 'none', borderRadius: 4,
                  cursor: !geometry ? 'not-allowed' : 'pointer',
                }}
              >
                ▶ {t('itinerary.startNav')}
              </button>
            </div>
          ) : (
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 10 }}>{t('itinerary.step3')}</Label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('itinerary.namePlaceholder')}
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 10,
                fontFamily: "'Space Grotesk'", fontSize: 13,
                background: tokens.cream, color: tokens.ink,
                border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, outline: 'none',
              }}
            />
            <button
              onClick={handleSave}
              disabled={waypoints.length < 2}
              style={{
                width: '100%', padding: '10px 12px',
                fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                background: waypoints.length < 2 ? tokens.creamBorder : tokens.terra,
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: waypoints.length < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              {activeId ? t('itinerary.update') : t('itinerary.save')}
            </button>
            <button
              onClick={handleExportGpx}
              disabled={!geometry || geometry.length < 2}
              style={{
                marginTop: 8, width: '100%', padding: '10px 12px',
                fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                background: 'transparent', color: !geometry ? tokens.creamBorder : tokens.ink,
                border: `1px solid ${!geometry ? tokens.creamBorder : tokens.ink}`, borderRadius: 4,
                cursor: !geometry ? 'not-allowed' : 'pointer',
              }}
            >
              ⤓ {t('itinerary.exportGpx')}
            </button>
            <button
              onClick={handleStartNavigation}
              disabled={!geometry || geometry.length < 2}
              style={{
                marginTop: 8, width: '100%', padding: '12px 12px',
                fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                background: !geometry ? tokens.creamBorder : tokens.green,
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: !geometry ? 'not-allowed' : 'pointer',
              }}
            >
              ▶ {t('itinerary.startNav')}
            </button>
          </div>
          )}

          {/* Cols near the departure — cycling only. Spans the full builder
              width (its own band under the 3 step cards). Selecting one adds it
              to the route; the stats bar then shows total D+ / difficulty. */}
          {sport === 'cycling' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <ColsPicker
                center={colCenter}
                radiusKm={colRadiusKm}
                setRadiusKm={setColRadiusKm}
                cols={nearbyCols}
                loading={colsLoading}
                errored={colsErrored}
                retry={colsRetry}
                selectedCodes={selectedColCodes}
                onToggle={toggleCol}
              />
            </div>
          )}

        </div>

        {/* ─── MAP + elevation profile (rendered below the builder via order) ─ */}
        <div style={{ order: 2, display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
          <div style={mapCardStyle}>
            <MapContainer
              center={mapCenter}
              zoom={waypoints.length > 0 ? 12 : 11}
              scrollWheelZoom={true}
              style={{ height: mapInnerHeight, width: '100%' }}
              maxZoom={20}
              minZoom={4}
              zoomSnap={0}
            >
              <BasemapTiles basemap={basemap} darkMode={dark} />
              <MapClickHandler onClick={handleMapClick} />
              <MapAutoResize />
              {polylinePositions && polylinePositions.length > 1 && (
                <Polyline positions={polylinePositions} pathOptions={{ color: tokens.terra, weight: 4, opacity: 0.85 }} />
              )}
              {waypoints.map((w, i) => (
                <CircleMarker
                  key={`${w.code}-${i}`}
                  center={[w.lat, w.lng]}
                  radius={5}
                  pathOptions={{ fillColor: tokens.terra, color: '#fff', weight: 1.5, fillOpacity: 1 }}
                >
                  {/* Name only on hover — keeps the map minimalist (just dots)
                      instead of plastering every stop's label across it. */}
                  <Tooltip direction="top" offset={[0, -6]}>
                    <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600 }}>
                      {i + 1}. {w.name}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}
              {/* Cols & summits near the departure (cycling). Each is a small
                  ⛰/🗻 emoji pin — no permanent label so the map stays clean.
                  Hover to see the name + altitude (black text) and click to add
                  it to / remove it from the route. Marker clicks never register
                  as a map click, so no phantom add-point popup. */}
              {sport === 'cycling' && colIcons && nearbyCols.map(c => {
                const sel = selectedColCodes.has(colCode(c));
                const icon = c.kind === 'col'
                  ? (sel ? colIcons.colSel : colIcons.col)
                  : (sel ? colIcons.sommetSel : colIcons.sommet);
                return (
                  <Marker
                    key={`col-${colCode(c)}`}
                    position={[c.lat, c.lng]}
                    icon={icon}
                    eventHandlers={{ click: () => toggleCol(c) }}
                  >
                    <Tooltip direction="top" offset={[0, -14]} opacity={1}>
                      <span style={{ display: 'block', textAlign: 'center', lineHeight: 1.3, fontFamily: "'Space Grotesk'", color: '#111' }}>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', color: '#111' }}>
                          {c.kind === 'col' ? '⛰' : '🗻'} {c.name}
                        </span>
                        {c.ele != null && (
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#111' }}>
                            {c.ele} m
                          </span>
                        )}
                        <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: sel ? tokens.terra : '#555', marginTop: 2 }}>
                          {sel ? (en ? '✓ click to remove' : '✓ clique pour retirer') : (en ? '+ click to add' : '+ clique pour ajouter')}
                        </span>
                      </span>
                    </Tooltip>
                  </Marker>
                );
              })}
              {/* Resupply points (water / food) along the route. */}
              {showPois && pois.map((p, i) => (
                <CircleMarker
                  key={`poi-${i}`}
                  center={[p.lat, p.lng]}
                  radius={6}
                  pathOptions={{ fillColor: POI_META[p.cat].color, color: '#fff', weight: 1.5, fillOpacity: 0.95 }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600 }}>
                      {POI_META[p.cat].icon} {p.name ?? POI_META[p.cat].label}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}
              {/* Synced hover marker: tracks the cursor on the elevation chart.
                  Two stacked circles for a "halo" effect so it stands out
                  against the route polyline. */}
              {hoverPos && (
                <>
                  <CircleMarker
                    center={hoverPos}
                    radius={14}
                    pathOptions={{ fillColor: tokens.blue, color: tokens.blue, weight: 0, fillOpacity: 0.25 }}
                  />
                  <CircleMarker
                    center={hoverPos}
                    radius={7}
                    pathOptions={{ fillColor: tokens.blue, color: '#fff', weight: 2, fillOpacity: 1 }}
                  />
                </>
              )}
              {/* Click-to-add: a pending marker sits at the exact clicked spot.
                  The confirmation card is rendered as a React overlay OUTSIDE
                  the Leaflet layers (below) so clicking its buttons can never
                  be read as a map click — the tracker just keeps it anchored. */}
              {clickPoint && (
                <CircleMarker
                  center={[clickPoint.lat, clickPoint.lng]}
                  radius={8}
                  pathOptions={{ fillColor: tokens.green, color: '#fff', weight: 2, fillOpacity: 1, dashArray: '0' }}
                />
              )}
              <ClickPopupTracker point={clickPoint} onMove={setClickPixel} />
              <FitBounds positions={polylinePositions ?? waypoints.map(w => [w.lat, w.lng] as [number, number])} zoomPercent={zoomPercent} />
            </MapContainer>
            <BasemapToggle basemap={basemap} onChange={setBasemap} />
            {/* Zoom-% pill — same control as the activity map (top-left,
                beside Leaflet's +/-). */}
            <ZoomPercentPill value={zoomPercent} onChange={setZoomPercent} />

            {/* Resupply toggle — shows water/food points along the route.
                Sits below the zoom +/- control (also top-left) so the two
                don't overlap. */}
            {geometry && geometry.length > 1 && (
              <div style={{ position: 'absolute', top: 84, left: 12, zIndex: 1100, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                <button
                  onClick={() => setShowPois(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 11px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: showPois ? tokens.terra : 'rgba(255,255,255,0.92)',
                    color: showPois ? '#fff' : tokens.ink,
                    fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)', backdropFilter: 'blur(4px)',
                  }}
                >
                  💧 {t('itinerary.resupply')}
                  {showPois && poisLoading && <span style={{ opacity: 0.85 }}>…</span>}
                  {showPois && !poisLoading && <span style={{ opacity: 0.85 }}>· {pois.length}</span>}
                </button>
                {showPois && !poisLoading && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 230,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid,
                  }}>
                    {pois.length === 0 ? (
                      <span>{t('itinerary.resupplyNone')}</span>
                    ) : POI_ORDER.filter(c => poiCounts[c] > 0).map(c => (
                      <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: POI_META[c].color, display: 'inline-block' }} />
                        {POI_META[c].label} <strong style={{ color: tokens.ink }}>{poiCounts[c]}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Confirmation card — a plain DOM overlay positioned over the
                clicked point. Sits outside <MapContainer>, so its button
                clicks never reach Leaflet and can't spawn a phantom popup. */}
            {clickPoint && clickPixel && (() => {
              // Flip below the point when there isn't room above (near the top
              // edge), so the card never gets clipped by the map's overflow.
              const below = clickPixel.y < 150;
              return (
              <div style={{
                position: 'absolute',
                left: clickPixel.x, top: clickPixel.y,
                transform: below ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 16px))',
                zIndex: 1200, width: 210,
                background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
                borderRadius: 8, padding: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                fontFamily: "'Space Grotesk'",
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.inkLight, marginBottom: 3 }}>
                      Ajouter ce point&nbsp;?
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: tokens.ink, lineHeight: 1.3 }}>
                      {clickLoading ? 'Localisation…' : (clickInfo?.name ?? 'Point sélectionné')}
                    </div>
                    {!clickLoading && clickInfo?.city && clickInfo.city !== clickInfo.name && (
                      <div style={{ fontSize: 10, color: tokens.inkLight, letterSpacing: '0.03em', marginTop: 1 }}>
                        {clickInfo.city}{clickInfo.postal ? ` · ${clickInfo.postal}` : ''}
                      </div>
                    )}
                  </div>
                  <button
                    aria-label="Fermer"
                    onClick={() => { setClickPoint(null); setClickInfo(null); }}
                    style={{
                      flexShrink: 0, width: 22, height: 22, lineHeight: '20px', textAlign: 'center',
                      background: 'transparent', border: `1px solid ${tokens.creamBorder}`, borderRadius: 4,
                      color: tokens.inkMid, cursor: 'pointer', fontSize: 13, padding: 0,
                    }}
                  >✕</button>
                </div>
                <button
                  onClick={confirmClickPoint}
                  style={{
                    width: '100%', padding: '9px 10px',
                    fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    background: tokens.green, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
                  }}
                >
                  + Ajouter au parcours
                </button>
                {/* Little pointer tail toward the clicked point. */}
                <div style={{
                  position: 'absolute', left: '50%',
                  ...(below
                    ? { top: -7, transform: 'translateX(-50%) rotate(45deg)', borderLeft: `1px solid ${tokens.creamBorder}`, borderTop: `1px solid ${tokens.creamBorder}` }
                    : { bottom: -7, transform: 'translateX(-50%) rotate(45deg)', borderRight: `1px solid ${tokens.creamBorder}`, borderBottom: `1px solid ${tokens.creamBorder}` }),
                  width: 12, height: 12, background: tokens.surface,
                }} />
              </div>
              );
            })()}
            {/* Discoverability hint for click-to-add — hidden while a popup
                is open so it doesn't compete with the confirmation. */}
            {!clickPoint && (
              <div style={{
                position: 'absolute', left: 12, bottom: 12, zIndex: 1000, pointerEvents: 'none',
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6,
                background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)',
                fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 500, letterSpacing: '0.02em',
              }}>
                <span aria-hidden>＋</span> {t('itinerary.mapHint')}
              </div>
            )}
          </div>

          {/* Route summary — distance, time, D+/D−, difficulty + average
              speed. Mirrors the iOS detail view's stats bar. Sits between the
              map and the elevation profile. */}
          {distanceKm != null && (() => {
            const osrmSpeed = durationS && durationS > 0 ? distanceKm / (durationS / 3600) : null;
            // Effective cruising speed: the user's override if set, otherwise
            // the routing engine's average (or a sane 18 km/h fallback).
            const effSpeed = speedOverride ?? (osrmSpeed ?? 18);
            // Estimated time follows the effective speed once overridden; with
            // no override we keep OSRM's own duration (most faithful to the road).
            const estSeconds = speedOverride != null
              ? (distanceKm / Math.max(1, speedOverride)) * 3600
              : durationS;
            const diff = routeDifficulty(distanceKm, ascent);
            return (
              <div style={{
                ...CARD, marginTop: 16,
                display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
              }}>
                {[
                  { label: t('itinerary.statDistance'), value: `${fmtNum(distanceKm, 1, lang)}`, unit: 'km',  color: tokens.ink },
                  { label: t('itinerary.statTime'),     value: estSeconds != null ? formatDuration(estSeconds) : '—', unit: '', color: tokens.ink },
                  { label: t('itinerary.statAscent'),   value: `${ascent.toLocaleString()}`,  unit: 'm', color: tokens.terra },
                  { label: t('itinerary.statDescent'),  value: `${descent.toLocaleString()}`, unit: 'm', color: tokens.blue },
                ].map(s => (
                  <div key={s.label} style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1.1 }}>
                      {s.value}{s.unit && <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 3, color: tokens.inkLight }}>{s.unit}</span>}
                    </div>
                    <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', marginTop: 2 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
                {/* Difficulty pill */}
                <div style={{ minWidth: 0 }}>
                  <span style={{
                    display: 'inline-block', padding: '5px 12px', borderRadius: 14,
                    background: diff.bg, color: diff.fg,
                    fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
                  }}>
                    {t(`itinerary.${diff.key}`)}
                  </span>
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', marginTop: 4 }}>
                    {t('itinerary.statDifficulty')}
                  </div>
                </div>
                {/* Speed — editable. Changing it recomputes the time above. */}
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 12px', borderRadius: 14,
                    background: tokens.creamDark,
                  }}>
                    <span style={{
                      fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600, color: tokens.inkMid, letterSpacing: '0.02em',
                    }}>
                      {t(`itinerary.${speedBand(effSpeed)}`)} ·
                    </span>
                    <input
                      type="number" min={5} max={50} step={1}
                      className="no-spinner"
                      value={Math.round(effSpeed)}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setSpeedOverride(Number.isFinite(v) && v > 0 ? Math.max(5, Math.min(50, v)) : null);
                      }}
                      aria-label={t('itinerary.statSpeed')}
                      style={{
                        width: 36, padding: '2px 6px', textAlign: 'center',
                        fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 700, color: tokens.ink,
                        background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 6, outline: 'none',
                      }}
                    />
                    <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600, color: tokens.inkLight }}>km/h</span>
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', marginTop: 4 }}>
                    {t('itinerary.statSpeed')}{speedOverride != null ? ' ·' : ''}{speedOverride != null ? (
                      <button onClick={() => setSpeedOverride(null)} style={{
                        marginLeft: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.terra, letterSpacing: '0.05em',
                      }}>auto</button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Elevation chart sits directly under the map so you can read both
              at once — and hovering it places a synced marker on the route
              above. */}
          {(eleLoading || elevSeries.length > 1) && (
            <ElevationChart
              data={elevSeries}
              totalAscent={ascent}
              totalDescent={descent}
              loading={eleLoading && elevSeries.length === 0}
              onHover={setHoverEleIdx}
            />
          )}

          {/* Way types + surfaces — below the elevation profile, side by side
              (Types de chemins | Surfaces). */}
          {wayAnalysis && (wayAnalysis.wayTypes.length > 0 || wayAnalysis.surfaces.length > 0) && (
            <div style={{ ...CARD, marginTop: 16, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>
              {([
                { title: 'Types de chemins', buckets: wayAnalysis.wayTypes },
                { title: 'Surfaces',          buckets: wayAnalysis.surfaces },
              ] as const).map(({ title, buckets }) => {
                if (buckets.length === 0) return null;
                const total = Math.max(1, buckets.reduce((s, b) => s + b.meters, 0));
                return (
                  <div key={title} style={{ minWidth: 0 }}>
                    <Label style={{ display: 'block', marginBottom: 8 }}>{title}</Label>
                    <div style={{ display: 'flex', height: 11, borderRadius: 6, overflow: 'hidden', gap: 1, marginBottom: 8 }}>
                      {buckets.map(b => (
                        <div key={b.key} style={{ width: `${(b.meters / total) * 100}%`, background: WAY_COLORS[b.key] ?? '#999' }} />
                      ))}
                    </div>
                    {buckets.map((b, i) => (
                      <div key={b.key} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                        borderBottom: i < buckets.length - 1 ? `1px solid ${tokens.creamBorder}` : 'none',
                      }}>
                        <span style={{ width: 14, height: 14, borderRadius: 4, background: WAY_COLORS[b.key] ?? '#999', flexShrink: 0 }} />
                        <span style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink }}>{b.label}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 12, color: tokens.inkMid }}>{fmtMeters(b.meters)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {wayLoading && !wayAnalysis && (
            <div style={{ ...CARD, marginTop: 16, fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight }}>
              Analyse des chemins et surfaces…
            </div>
          )}

        </div>
      </div>

      {/* ─── LIBRARY ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 32 }}>
        <Label style={{ display: 'block', marginBottom: 12 }}>
          {t('itinerary.library')} {library.length > 0 && <span style={{ color: tokens.terra }}>· {library.length}</span>}
        </Label>
        {library.length === 0 ? (
          <div style={{ ...CARD, fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, lineHeight: 1.6 }}>
            {t('itinerary.libraryEmpty')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {library.map(it => (
              <div key={it.id} style={{
                ...CARD, padding: 14,
                borderTop: activeId === it.id ? `2px solid ${tokens.terra}` : `1px solid ${tokens.creamBorder}`,
                cursor: 'pointer',
              }} onClick={() => { void handleLoad(it); }}>
                <div style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: tokens.ink, marginBottom: 4 }}>
                  {it.loop ? '↺ ' : ''}{it.name}
                </div>
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginBottom: 8, letterSpacing: '0.05em' }}>
                  {it.waypoints.length} {t('itinerary.stops')}
                  {it.distanceKm != null && ` · ${it.distanceKm} km`}
                  {it.durationMin != null && ` · ${formatDuration(it.durationMin * 60)}`}
                  {it.totalAscent != null && ` · ↗ ${it.totalAscent} m`}
                </div>
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.4, marginBottom: 8 }}>
                  {it.waypoints.slice(0, 4).map(w => w.name).join(' → ')}
                  {it.waypoints.length > 4 && ` → +${it.waypoints.length - 4}`}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, letterSpacing: '0.05em' }}>
                    {new Date(it.createdAt).toLocaleDateString()}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(it.id); }} style={{
                    fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                    background: 'none', border: 'none', color: tokens.inkLight, cursor: 'pointer',
                  }}>
                    {t('itinerary.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Outer>
  );
}

function iconBtnStyle(disabled: boolean, danger = false): CSSProperties {
  return {
    width: 24, height: 24,
    background: 'transparent', border: 'none', borderRadius: 3,
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? tokens.creamBorder : (danger ? tokens.terra : tokens.inkMid),
    fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.5 : 1,
  };
}
