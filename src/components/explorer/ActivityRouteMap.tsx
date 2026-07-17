'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, Polyline, Popup, CircleMarker, useMap } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, tokens } from './tokens';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';
import { FullscreenRefit } from './itinerary/FitBounds';

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

const MASS = 74.18, G = 9.81, CRR = 0.004, CDA = 0.3, RHO = 1.225;

function calcPowerAt(speed_ms: number, grad_pct: number): number {
  const gr = grad_pct / 100;
  return Math.max(0, Math.round(
    (MASS * G * gr + MASS * G * CRR + 0.5 * RHO * CDA * speed_ms * speed_ms) * speed_ms
  ));
}

function computeGradient(altitude: number[], distance_m: number[], len: number): number[] {
  const WINDOW = 40;
  const gradient = new Array(len).fill(0);
  for (let i = WINDOW; i < len - WINDOW; i++) {
    const dAlt  = altitude[i + WINDOW] - altitude[i - WINDOW];
    const dDist = distance_m[i + WINDOW] - distance_m[i - WINDOW];
    if (dDist >= 20) gradient[i] = Math.max(-25, Math.min(25, (dAlt / dDist) * 100));
  }
  return gradient;
}

function buildSegments(
  positions: [number, number][],
  speeds: number[],
  targetSegments: number,
): { pts: [number, number][]; color: string }[] {
  const n = positions.length;
  if (n < 2 || !speeds.length) return [];

  const mapped = positions.map((_, i) => {
    const si = Math.round((i / (n - 1)) * (speeds.length - 1));
    return speeds[Math.max(0, Math.min(si, speeds.length - 1))];
  });

  const sorted = [...mapped].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1], range = max - min || 1;

  const chunkSize = Math.max(1, Math.floor(n / targetSegments));
  const result: { pts: [number, number][]; color: string }[] = [];

  for (let i = 0; i < n - 1; i += chunkSize) {
    const end = Math.min(i + chunkSize + 1, n);
    const chunk = mapped.slice(i, end);
    const avg = chunk.reduce((s, v) => s + v, 0) / chunk.length;
    const t = (avg - min) / range;
    result.push({ pts: positions.slice(i, end), color: `hsl(${Math.round(t * 120)}, 90%, 45%)` });
  }
  return result;
}

/**
 * Drives the map's viewport.
 *
 * Behaviour:
 *   - On mount: fit to the entire route (default "you see your whole
 *     ride" view).
 *   - When `focus` becomes non-null (user hovered a climb): zoom to
 *     the segment's GPS bounds with a smooth animated transition.
 *   - When `focus` becomes null (user un-hovered): zoom back out.
 *   - `zoomPercent` shifts the zoom level applied on top of fitBounds.
 *     100 = default fitBounds, < 100 = more zoomed out, > 100 = more
 *     zoomed in. Step is half a Leaflet zoom level per 25 % so the
 *     range 50–175 % feels meaningful without crashing into integer
 *     zoom snapping.
 *
 * The animation uses leaflet's `flyToBounds` instead of `fitBounds`
 * so the camera glides rather than jumps.
 */
function FitBounds({
  positions,
  focus,
  zoomPercent,
}: {
  positions: [number, number][];
  focus: [number, number][] | null;
  zoomPercent: number;
}) {
  const map = useMap();

  // Convert the % control into a zoom delta applied AFTER fitBounds.
  // 100 → 0, 75 → -1, 125 → +1, 150 → +2 (rounded to integer zoom).
  const zoomOffset = Math.round((zoomPercent - 100) / 25);

  // Initial fit — runs once on mount.
  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(positions, { padding: [24, 24] });
      if (zoomOffset !== 0) {
        map.setZoom(Math.max(2, Math.min(18, map.getZoom() + zoomOffset)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit when focus OR the user-chosen zoom level changes.
  useEffect(() => {
    if (positions.length < 2) return;
    const target = focus && focus.length >= 2 ? focus : positions;
    const isSegment = focus && focus.length >= 2;
    map.flyToBounds(target, {
      padding:  isSegment ? [60, 60] : [24, 24],
      duration: 0.5,
      // maxZoom 13 (was 15) — Florian found the segment fly-in zoomed
      // in too aggressively. Dropping 2 zoom levels widens the
      // visible area ~4× (each Leaflet level halves the area), so a
      // hovered climb now sits in geographic context rather than
      // filling the entire viewport.
      maxZoom:  isSegment ? 13 : undefined,
    });
    // Apply the user's zoom offset slightly after the fly finishes so
    // we end up at the offset zoom rather than fighting the animation.
    if (zoomOffset !== 0) {
      const t = setTimeout(() => {
        map.setZoom(Math.max(2, Math.min(18, map.getZoom() + zoomOffset)));
      }, 560);
      return () => clearTimeout(t);
    }
  }, [map, focus, positions, zoomOffset]);

  return null;
}

interface HoverData {
  latlng: { lat: number; lng: number };
  dist: number;
  hr: number | null;
  speed: number | null;
  power: number;
  altitude: number | null;
  gradient: number;
}

function dataAtIndex(idx: number, activity: Activity, positions: [number, number][], gradient: number[]): HoverData {
  const speed_kmh = activity.speed_kmh?.[idx] ?? 0;
  const speed_ms  = speed_kmh / 3.6;
  const grad      = gradient[idx] ?? 0;
  return {
    latlng:   { lat: positions[idx][0], lng: positions[idx][1] },
    dist:     +((activity.distance_m?.[idx] ?? 0) / 1000).toFixed(2),
    hr:       activity.heartrate?.[idx] ?? null,
    speed:    +speed_kmh.toFixed(1),
    power:    calcPowerAt(speed_ms, grad),
    altitude: activity.altitude?.[idx] != null ? Math.round(activity.altitude![idx]) : null,
    gradient: +grad.toFixed(1),
  };
}

function RouteWithHover({ activity, positions, gradient, highlightSegment }: {
  activity: Activity;
  positions: [number, number][];
  gradient: number[];
  highlightSegment: { startIdx: number; endIdx: number } | null;
}) {
  const [info, setInfo] = useState<HoverData | null>(null);
  const speeds   = activity.speed_kmh ?? [];
  const segments = buildSegments(positions, speeds, 200);

  // Clamp the highlight indices into the actual GPS array length —
  // streams can disagree (Strava sometimes returns a slightly shorter
  // altitude array than distance), so a climb's endIdx might point
  // past gps.length on the rare malformed activity.
  const highlightPositions = (() => {
    if (!highlightSegment) return null;
    const s = Math.max(0, Math.min(highlightSegment.startIdx, positions.length - 1));
    const e = Math.max(s, Math.min(highlightSegment.endIdx, positions.length - 1));
    if (e - s < 2) return null;
    return positions.slice(s, e + 1);
  })();

  const handleMouseMove = (e: LeafletMouseEvent) => {
    const { lat, lng } = e.latlng;
    let nearestIdx = 0, minDist = Infinity;
    for (let i = 0; i < positions.length; i += 5) {
      const d = Math.hypot(positions[i][0] - lat, positions[i][1] - lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const s = Math.max(0, nearestIdx - 10), end = Math.min(positions.length - 1, nearestIdx + 10);
    for (let i = s; i <= end; i++) {
      const d = Math.hypot(positions[i][0] - lat, positions[i][1] - lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    setInfo({ ...dataAtIndex(nearestIdx, activity, positions, gradient), latlng: { lat: e.latlng.lat, lng: e.latlng.lng } });
  };

  const handleMouseOut = () => setInfo(null);

  return (
    <>
      {/* Speed heatmap segments */}
      {segments.map((seg, i) => (
        <Polyline key={i} positions={seg.pts} pathOptions={{ color: seg.color, weight: 5, opacity: 0.9 }} />
      ))}

      {/* Climb highlight — drawn ABOVE the base segments so it pops on
          hover. Two layers: a thick semi-transparent halo (visual
          "glow") + a punchy core stroke. Stays inert (no event
          handlers) so the hover-info overlay still catches mouse
          events on the surrounding stretches. */}
      {highlightPositions && (
        <>
          <Polyline
            positions={highlightPositions}
            pathOptions={{ color: tokens.terra, weight: 14, opacity: 0.35, lineCap: 'round' }}
          />
          <Polyline
            positions={highlightPositions}
            pathOptions={{ color: tokens.terra, weight: 7, opacity: 1.0, lineCap: 'round' }}
          />
        </>
      )}

      {/* Invisible overlay for hover events */}
      <Polyline
        positions={positions}
        pathOptions={{ color: 'transparent', weight: 14, opacity: 0.01 }}
        eventHandlers={{ mousemove: handleMouseMove, mouseout: handleMouseOut }}
      />
      {info && (
        <Popup
          className="tle-hover-popup"
          position={[info.latlng.lat, info.latlng.lng]}
          offset={[0, -8]}
          closeButton={false}
          autoClose={false}
          closeOnClick={false}
        >
          <div style={{
            fontFamily: 'Space Grotesk, sans-serif', fontSize: 12.5, lineHeight: 1.5,
            background: tokens.surface, color: tokens.ink, whiteSpace: 'nowrap',
            padding: '8px 11px', borderRadius: 8, border: `1px solid ${tokens.creamBorder}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: info.speed != null ? `hsl(${Math.round(Math.min(1, (info.speed / 50)) * 120)}, 90%, 45%)` : tokens.terra }} />
              {info.dist} km
            </div>
            <div>Pente <strong>{info.gradient > 0 ? '+' : ''}{info.gradient} %</strong></div>
            {info.hr != null && <div>FC <strong>{info.hr} bpm</strong></div>}
            <div>Vitesse <strong>{info.speed} km/h</strong></div>
            {info.altitude != null && <div>Altitude <strong>{info.altitude} m</strong></div>}
          </div>
        </Popup>
      )}
    </>
  );
}

export function ActivityRouteMap({
  activity,
  highlightSegment,
  photoPins,
}: {
  activity: Activity;
  /** Geolocated photos to pin on the map (lat/lng from EXIF). */
  photoPins?: { lat: number; lng: number; url: string }[];
  /** Optional climb / segment to highlight + focus on. Indices are
   *  into the activity's altitude/distance streams; we clamp into
   *  the GPS array's bounds defensively in case Strava returned
   *  mismatched stream lengths. Used by the Climbs card on the
   *  parent AnalysisPage when the user hovers a climb row — drives
   *  both the orange highlight overlay AND a map zoom flying to that
   *  segment (cleared on un-hover → fly back to full route). */
  highlightSegment?: { startIdx: number; endIdx: number } | null;
}) {
  const dark = useDarkMode();
  const [basemap, setBasemap] = useBasemap();
  const { gps, altitude = [], distance_m = [] } = activity;
  // `positions` is memoized so its array reference is stable across
  // renders. Without this, every parent re-render (which happens on
  // every climb hover) would produce a fresh `positions` array →
  // FitBounds's useEffect deps would fire → fly-to would loop.
  const positions = useMemo(
    () => (gps ?? []).map(p => [p.lat, p.lng] as [number, number]),
    [gps],
  );
  // Same memo for focus coordinates — derived from highlightSegment +
  // positions. Null when no climb is hovered.
  const focusCoords = useMemo(() => {
    if (!highlightSegment) return null;
    const s = Math.max(0, Math.min(highlightSegment.startIdx, positions.length - 1));
    const e = Math.max(s, Math.min(highlightSegment.endIdx,   positions.length - 1));
    if (e - s < 2) return null;
    return positions.slice(s, e + 1);
  }, [highlightSegment, positions]);

  // User-controlled default zoom — picks a % offset relative to the
  // auto-fitted view. Persists in localStorage so the choice carries
  // across activities + reloads.
  const [zoomPercent, setZoomPercent] = useZoomPercent();
  // Fullscreen map — blow the route map up to the whole viewport.
  const [mapFull, setMapFull] = useState(false);

  if (!gps || gps.length < 2) return null;

  const len      = Math.min(gps.length, altitude.length, distance_m.length);
  const gradient = computeGradient(altitude, distance_m, len);
  const center   = positions[Math.floor(positions.length / 2)];

  const mapCard = (
    <div style={mapFull
      ? { position: 'fixed', inset: 0, width: '100vw', height: '100dvh', zIndex: 4000, background: tokens.cream, overflow: 'hidden' }
      : { position: 'relative' }
    }>
      <MapContainer
        center={center}
        zoom={12}
        // 600px normally — taller so all 5 climbs fit in the right-hand
        // column without scrolling. Fullscreen fills its parent (the whole
        // viewport once portalled to <body>).
        style={{ height: mapFull ? '100%' : 600, width: '100%', borderRadius: mapFull ? 0 : 4 }}
        scrollWheelZoom={mapFull}
        zoomSnap={1}
      >
        <BasemapTiles basemap={basemap} darkMode={dark} />
        <RouteWithHover
          activity={activity}
          positions={positions}
          gradient={gradient}
          highlightSegment={highlightSegment ?? null}
        />
        <FitBounds positions={positions} focus={focusCoords} zoomPercent={zoomPercent} />
        <FullscreenRefit active={mapFull} positions={positions} zoomPercent={zoomPercent} />
        {/* Geolocated photos pinned where they were taken. */}
        {(photoPins ?? []).map((p, i) => (
          <CircleMarker key={i} center={[p.lat, p.lng]} radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: tokens.terra, fillOpacity: 1 }}>
            <Popup>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" style={{ width: 180, maxHeight: 180, objectFit: 'cover', display: 'block', borderRadius: 6 }} />
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} />
      <ZoomPercentPill value={zoomPercent} onChange={setZoomPercent} />
      {/* Fullscreen toggle — enlarge the route map to the whole screen,
          then collapse back. Sits top-right under the PLAN/SAT toggle. */}
      <button
        onClick={() => setMapFull(v => !v)}
        title={mapFull ? 'Réduire la carte' : 'Agrandir la carte'}
        style={{
          position: 'absolute', top: 56, right: 12, zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 11px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: mapFull ? tokens.terra : 'rgba(255,255,255,0.92)',
          color: mapFull ? '#fff' : tokens.ink,
          fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', backdropFilter: 'blur(4px)',
        }}
      >
        {mapFull ? '⤡ Réduire' : '⤢ Agrandir'}
      </button>
    </div>
  );

  // When fullscreen, portal the map to <body> so `position: fixed` escapes
  // any transformed / overflow-clipped ancestor — that ancestor was pinning
  // the fullscreen map to the top ~2/3 of the screen (cream showing below).
  // Inline in the normal (non-fullscreen) layout.
  return mapFull && typeof document !== 'undefined'
    ? createPortal(mapCard, document.body)
    : mapCard;
}

// ── Zoom % selector ──────────────────────────────────────────────────────
// Lets the user pick a default zoom level relative to the auto-fitted
// view. Saved per-browser so picking "125 %" once carries to every
// future activity opened on this device.

const ZOOM_PERCENT_KEY = 'tle_map_zoom_percent_v1';
const ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200];

function useZoomPercent(): [number, (v: number) => void] {
  const [percent, setPercentState] = useState<number>(100);
  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(ZOOM_PERCENT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && ZOOM_OPTIONS.includes(parsed)) {
      setPercentState(parsed);
    }
  }, []);
  const setPercent = useCallback((v: number) => {
    setPercentState(v);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ZOOM_PERCENT_KEY, String(v));
    }
  }, []);
  return [percent, setPercent];
}

/** Pill UI matching BasemapToggle's style, placed top-left of the map. */
function ZoomPercentPill({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        position:      'absolute',
        top:           12,
        left:          50,           // sit to the right of the Leaflet +/- control
        zIndex:        1000,
        background:    tokens.surface,
        border:        `1px solid ${tokens.creamBorder}`,
        borderRadius:  999,
        padding:       '2px 4px',
        display:       'flex',
        alignItems:    'center',
        gap:           4,
        boxShadow:     '0 2px 6px rgba(0,0,0,0.15)',
        pointerEvents: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <span style={{
        fontFamily:    "'Space Grotesk'",
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: '0.06em',
        color:         tokens.inkLight,
        textTransform: 'uppercase',
        padding:       '0 6px',
      }}>Zoom</span>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          background:   'transparent',
          border:       'none',
          borderRadius: 999,
          padding:      '4px 6px',
          fontFamily:   "'Space Grotesk'",
          fontSize:     11,
          fontWeight:   700,
          color:        tokens.ink,
          cursor:       'pointer',
          appearance:   'none',
        }}
      >
        {ZOOM_OPTIONS.map(p => (
          <option key={p} value={p}>{p}%</option>
        ))}
      </select>
    </div>
  );
}
