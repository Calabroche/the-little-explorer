'use client';

import { useState, useEffect, useRef, useCallback, useMemo, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { useT } from '@/i18n';
import { UserId } from '../Sidebar';
import { Waypoint, Itinerary } from '../itinerary/types';
import { loadAll, upsert, remove, newId } from '../itinerary/storage';
import { downsampleByDistance, buildElevationSeries, ascentDescent, haversineM } from '../itinerary/elevation';
import { ElevationChart } from '../itinerary/ElevationChart';
import { buildGpx, downloadGpx, slugify as gpxSlug } from '../itinerary/gpx';

// Leaflet pulls in `window` at import time → ssr:false.
const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then(m => m.TileLayer),    { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(m => m.Polyline),     { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false });
const Tooltip      = dynamic(() => import('react-leaflet').then(m => m.Tooltip),      { ssr: false });
const FitBounds    = dynamic(() => import('../itinerary/FitBounds').then(m => m.FitBounds), { ssr: false });

interface Props {
  user: UserId;
  // When rendered inside another page (e.g. PlannerPage as a tab),
  // we skip the page-level wrapper (padding/scroll) and the
  // SectionTag/headline — the host page handles those.
  embedded?: boolean;
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

export function ItineraryPage({ user, embedded }: Props) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const dark = useDarkMode();

  const [waypoints, setWaypoints]     = useState<Waypoint[]>([]);
  const [targetKm, setTargetKm]       = useState<number>(50);
  const [loop, setLoop]               = useState<boolean>(false);
  const [name, setName]               = useState<string>('');
  const [activeId, setActiveId]       = useState<string | null>(null);

  const [geometry, setGeometry]       = useState<[number, number][] | null>(null);
  const [distanceM, setDistanceM]     = useState<number | null>(null);
  const [durationS, setDurationS]     = useState<number | null>(null);
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

  useEffect(() => { setLibrary(loadAll(user)); }, [user]);

  // ── Waypoint manipulation ────────────────────────────────────────────────
  const addWaypoint  = (w: Waypoint) => setWaypoints(prev =>
    prev.some(p => p.code === w.code) ? prev : [...prev, w]
  );
  const removeWaypoint = (idx: number) => setWaypoints(prev => prev.filter((_, i) => i !== idx));
  const moveWaypoint   = (idx: number, dir: -1 | 1) => setWaypoints(prev => {
    const next = [...prev];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const clearAll = () => {
    setWaypoints([]); setGeometry(null); setDistanceM(null); setDurationS(null);
    setName(''); setActiveId(null); setRouteError(null);
    setElevSeries([]); setElevations(null); setElevIndices(null); setAscent(0); setDescent(0);
  };

  // ── Routing ──────────────────────────────────────────────────────────────
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
        body: JSON.stringify({ waypoints: eff.map(w => [w.lat, w.lng]) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setGeometry(data.geometry);
      setDistanceM(data.distance_m);
      setDurationS(data.duration_s);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRouteError(msg);
      setGeometry(null); setDistanceM(null); setDurationS(null);
    } finally {
      setRouting(false);
    }
  }, [waypoints, loop]);

  useEffect(() => {
    const id = setTimeout(computeRoute, 300);
    return () => clearTimeout(id);
  }, [computeRoute]);

  // ── Elevation: fetch a downsampled profile each time the geometry changes
  useEffect(() => {
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
        const { ascent, descent } = ascentDescent(data.elevations);
        setElevSeries(series);
        setElevations(data.elevations);
        setElevIndices(indices);
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
      elevSampleIndices: elevIndices ?? undefined,
      elevations:        elevations ?? undefined,
      totalAscent:       ascent || undefined,
      totalDescent:      descent || undefined,
    };
    setLibrary(upsert(user, it));
    setActiveId(it.id);
    setName(it.name);
  };

  const handleLoad = (it: Itinerary) => {
    setActiveId(it.id);
    setName(it.name);
    setWaypoints(it.waypoints);
    setTargetKm(it.targetKm);
    setLoop(!!it.loop);
    setGeometry(it.geometry ?? null);
    setDistanceM(it.distanceKm != null ? it.distanceKm * 1000 : null);
    setDurationS(it.durationMin != null ? it.durationMin * 60 : null);
    setRouteError(null);
    // Restore elevation cache if present — saves an opentopodata call.
    if (it.geometry && it.elevSampleIndices && it.elevations) {
      const series = buildElevationSeries(it.geometry, it.elevSampleIndices, it.elevations);
      setElevSeries(series);
      setElevations(it.elevations);
      setElevIndices(it.elevSampleIndices);
      setAscent(it.totalAscent ?? 0);
      setDescent(it.totalDescent ?? 0);
    } else {
      setElevSeries([]); setElevations(null); setElevIndices(null); setAscent(0); setDescent(0);
    }
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t('itinerary.confirmDelete'))) return;
    const next = remove(user, id);
    setLibrary(next);
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
      upsert(user, it);
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
  // Default view: anchored on Dardilly with enough zoom to see the
  // useful neighbourhood (Tassin, Charbonnières, La Tour-de-Salvagny,
  // Lyon at the corner) — the area where Florian's rides actually
  // start. Switches to the first waypoint once the user adds one.
  const mapCenter = useMemo<[number, number]>(() => {
    if (waypoints.length > 0) return [waypoints[0].lat, waypoints[0].lng];
    return [45.81, 4.78];
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
  //             two layers stacked instead of the merged `dark_all` so
  //             we can swap the labels overlay independently later.
  const lightUrl         = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const lightAttribution = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap';
  const darkBaseUrl      = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
  const darkLabelsUrl    = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';
  const darkAttribution  = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap';

  // Map grew by +200px vs the previous V1 to leave room for the
  // elevation chart underneath without scrolling pressure.
  const mapHeight = isMobile ? 560 : 720;

  // ── Layout ───────────────────────────────────────────────────────────────
  const CARD: CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 20,
  };

  const canExtend = distanceKm != null && targetKm - distanceKm >= 3 && !extending && !routing;

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

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: isMobile ? '1fr' : '380px 1fr' }}>
        {/* ─── LEFT COLUMN: builder ─────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Step 1: villages */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 10 }}>{t('itinerary.step1')}</Label>
            <VillageSearch onPick={addWaypoint} placeholder={t('itinerary.searchPlaceholder')} />
            {waypoints.length === 0 && (
              <p style={{ marginTop: 12, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.5 }}>
                {t('itinerary.searchHint')}
              </p>
            )}
            {waypoints.length > 0 && (
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
          </div>

          {/* Step 2: target distance + loop + auto-extend */}
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
                {[30, 50, 80, 120].map(km => (
                  <button key={km} onClick={() => setTargetKm(km)} style={{
                    padding: '4px 10px', fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 500,
                    background: targetKm === km ? tokens.terra : tokens.creamDark,
                    color: targetKm === km ? '#fff' : tokens.inkMid,
                    border: 'none', borderRadius: 12, cursor: 'pointer',
                  }}>{km}</button>
                ))}
              </div>
            </div>

            {/* Loop toggle */}
            <div style={{
              marginTop: 12, display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', background: tokens.creamDark, borderRadius: 3,
            }}>
              <button
                role="switch"
                aria-checked={loop}
                onClick={() => setLoop(v => !v)}
                style={{
                  width: 36, height: 20, padding: 2,
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
                  {t('itinerary.loop')}
                </div>
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.04em', marginTop: 1 }}>
                  {t('itinerary.loopHint')}
                </div>
              </div>
            </div>

            {distanceKm != null && (
              <div style={{ marginTop: 14, padding: 12, background: tokens.creamDark, borderRadius: 3 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 800, color: tokens.terra }}>
                    {distanceKm}
                  </span>
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>km {t('itinerary.computed')}</span>
                  {durationS != null && (
                    <span style={{ marginLeft: 'auto', fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
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

          {/* Step 3: save + export */}
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
        </div>

        {/* ─── RIGHT COLUMN: map + elevation profile ───────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
          <div style={{ ...CARD, padding: 0, overflow: 'hidden', minHeight: mapHeight, position: 'relative' }}>
            <MapContainer
              center={mapCenter}
              zoom={waypoints.length > 0 ? 12 : 11}
              scrollWheelZoom={true}
              style={{ height: mapHeight, width: '100%' }}
              maxZoom={20}
              minZoom={4}
            >
              {dark ? (
                <>
                  {/* Dark: CARTO Dark Matter base (no labels) +
                      CARTO labels overlay. Two TileLayers stacked. */}
                  <TileLayer
                    key="dark-base"
                    url={darkBaseUrl}
                    attribution={darkAttribution}
                    maxZoom={20}
                    maxNativeZoom={19}
                  />
                  <TileLayer
                    key="dark-labels"
                    url={darkLabelsUrl}
                    maxZoom={20}
                    maxNativeZoom={19}
                  />
                </>
              ) : (
                <TileLayer
                  key="light"
                  url={lightUrl}
                  attribution={lightAttribution}
                  maxZoom={20}
                  maxNativeZoom={20}
                />
              )}
              {polylinePositions && polylinePositions.length > 1 && (
                <Polyline positions={polylinePositions} pathOptions={{ color: tokens.terra, weight: 4, opacity: 0.85 }} />
              )}
              {waypoints.map((w, i) => (
                <CircleMarker
                  key={`${w.code}-${i}`}
                  center={[w.lat, w.lng]}
                  radius={9}
                  pathOptions={{ fillColor: tokens.terra, color: '#fff', weight: 2, fillOpacity: 1 }}
                >
                  <Tooltip permanent direction="top" offset={[0, -10]}>
                    <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600 }}>
                      {i + 1}. {w.name}
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
              <FitBounds positions={polylinePositions ?? waypoints.map(w => [w.lat, w.lng] as [number, number])} />
            </MapContainer>
          </div>

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
              }} onClick={() => handleLoad(it)}>
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
