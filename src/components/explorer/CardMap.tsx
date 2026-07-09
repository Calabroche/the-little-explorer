'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, tokens } from './tokens';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';

// CardMap is an embedded preview inside each ActivityCard on the feed.
// It does carry a compact Plan/Sat toggle (top-right of the preview)
// and a custom hover tooltip that shows per-point ride metrics (dist
// along route, slope, FC, speed, power, altitude) — same data the
// activity-detail map shows, so the user can scan rides without
// drilling in.
//
// Tooltip impl note: we render the tooltip as a plain absolute-positioned
// React div outside the MapContainer instead of a Leaflet <Popup>. The
// Popup approach (with autoPan) was causing visible lag — Leaflet
// re-rendered the popup + ran an autoPan animation on every mousemove
// (60+/sec). The custom div is purely React state + CSS — no Leaflet
// re-render on hover, no animation thrash, smooth even with multiple
// cards visible at once.

// ── Physics for power estimation at a point ──────────────────────────────
const G    = 9.81;
const CRR  = 0.004;
const CDA  = 0.3;
const RHO  = 1.225;
const MASS = 74;
function calcPowerAt(speed_ms: number, grad_pct: number): number {
  const gr = grad_pct / 100;
  return Math.max(0, Math.round(
    (MASS * G * gr + MASS * G * CRR + 0.5 * RHO * CDA * speed_ms * speed_ms) * speed_ms,
  ));
}

// Smoothed gradient from altitude + distance streams. WINDOW=40 samples
// matches the detail map so a card hover reports the same % as the
// detail map for the same spot.
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

function buildSegments(
  positions: [number, number][],
  speeds: number[],
  targetSegments: number,
): { pts: [number, number][]; color: string }[] {
  const n = positions.length;
  if (n < 2 || !speeds.length) return [];

  // Map each position index to a speed value by ratio
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

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    // invalidateSize forces Leaflet to recompute the container size and (re)load
    // tiles — without it a map created before its card has its final height
    // renders on a grey background. Fit now, then again after layout settles.
    const apply = () => {
      map.invalidateSize();
      if (positions.length > 1) map.fitBounds(positions, { padding: [6, 6] });
    };
    apply();
    const t = setTimeout(apply, 250);
    return () => clearTimeout(t);
  }, [map, positions]);
  return null;
}

function downsample(pts: { lat: number; lng: number }[], max: number) {
  const step = Math.max(1, Math.floor(pts.length / max));
  return pts.filter((_, i) => i % step === 0);
}

// ── Hover info ───────────────────────────────────────────────────────────

interface HoverInfo {
  /** Container-relative x/y (CSS pixels) where the tooltip anchors. */
  x: number;
  y: number;
  dist:     number;
  hr:       number | null;
  speed:    number;
  power:    number;
  altitude: number | null;
  gradient: number;
}

/**
 * Look up a value in `arr` by the *ratio* of the hover index inside
 * the downsampled `positions` array. Maps fractional position → stream
 * index so hovering at km 25 of a 50km ride returns sample ~50% of
 * the way through the stream, regardless of whether streams are
 * 200 or 2000 samples long.
 */
function valueAtRatio<T>(arr: T[] | undefined | null, hoverIdx: number, posLen: number): T | null {
  if (!arr || arr.length === 0 || posLen < 2) return null;
  const ratio  = hoverIdx / (posLen - 1);
  const srcIdx = Math.round(ratio * (arr.length - 1));
  return arr[Math.max(0, Math.min(srcIdx, arr.length - 1))];
}

/**
 * Lives inside MapContainer. Catches mousemove on an invisible thick
 * polyline, computes the metrics at that position, pushes them to the
 * parent via `onHover`. On mouseout, calls `onHover(null)` AND
 * re-fits the map to the full route — so the camera returns to the
 * initial framing the moment the cursor leaves.
 *
 * Throttled to requestAnimationFrame so a fast mouse doesn't queue
 * 60+ React updates per second.
 */
function HoverCatcher({
  activity, positions, gradient, onHover,
}: {
  activity: Activity;
  positions: [number, number][];
  /** Already re-sampled to positions.length — same index space. */
  gradient: number[];
  onHover:  (info: HoverInfo | null) => void;
}) {
  const map = useMap();
  const rafRef = useRef<number | null>(null);
  const lastIdxRef = useRef<number>(-1);

  // Cleanup any pending rAF on unmount
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handleMouseMove = (e: LeafletMouseEvent) => {
    // Throttle: collapse all mousemoves between two frames into one
    // setInfo. Without this we'd re-render the tooltip 60+×/sec → jank.
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const { lat, lng } = e.latlng;

      // Two-pass nearest-neighbour: coarse stride-5 sweep then a
      // ±10-sample refinement. Avoids walking ~200 points on every
      // mouse move while staying accurate at native resolution.
      let nearestIdx = 0, minDist = Infinity;
      for (let i = 0; i < positions.length; i += 5) {
        const d = Math.hypot(positions[i][0] - lat, positions[i][1] - lng);
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }
      const s = Math.max(0, nearestIdx - 10);
      const end = Math.min(positions.length - 1, nearestIdx + 10);
      for (let i = s; i <= end; i++) {
        const d = Math.hypot(positions[i][0] - lat, positions[i][1] - lng);
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }

      // Skip the update if we landed on the same point as last frame —
      // tooltip content + position would be identical. Saves the React
      // re-render entirely.
      if (nearestIdx === lastIdxRef.current) return;
      lastIdxRef.current = nearestIdx;

      const L = positions.length;
      const speedKmh = valueAtRatio(activity.speed_kmh, nearestIdx, L) ?? 0;
      const speedMs  = speedKmh / 3.6;
      const grad     = gradient[nearestIdx] ?? 0;
      const distM    = valueAtRatio(activity.distance_m, nearestIdx, L) ?? 0;
      const hr       = valueAtRatio(activity.heartrate,  nearestIdx, L);
      const alt      = valueAtRatio(activity.altitude,   nearestIdx, L);

      onHover({
        x:        e.containerPoint.x,
        y:        e.containerPoint.y,
        dist:     +(distM / 1000).toFixed(2),
        hr:       hr ?? null,
        speed:    +speedKmh.toFixed(1),
        power:    calcPowerAt(speedMs, grad),
        altitude: alt != null ? Math.round(alt) : null,
        gradient: +grad.toFixed(1),
      });
    });
  };

  const handleMouseOut = () => {
    // Cancel any in-flight rAF so a late frame doesn't repaint the
    // tooltip right after we cleared it.
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    lastIdxRef.current = -1;
    onHover(null);
    // Snap the camera back to the full route framing — undoes any
    // tiny pan Leaflet did to keep the cursor's position in view.
    if (positions.length > 1) {
      map.fitBounds(positions, { padding: [6, 6], animate: true, duration: 0.25 });
    }
  };

  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: 'transparent', weight: 14, opacity: 0.01 }}
      eventHandlers={{ mousemove: handleMouseMove, mouseout: handleMouseOut }}
    />
  );
}

export function CardMap({
  gps, color, height = 180, speedKmh, activity,
}: {
  gps: { lat: number; lng: number }[];
  color: string;
  height?: number | string;
  speedKmh?: number[];
  /**
   * Pass the full Activity to enable the per-point hover tooltip
   * (distance along the route, slope, speed, HR, power, altitude).
   * If omitted, the card renders as a static preview.
   */
  activity?: Activity;
}) {
  const dark = useDarkMode();
  const [basemap, setBasemap] = useBasemap();
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Gradient computation runs on the FULL streams (altitude/distance_m,
  // typically 1000+ samples). Skipped when streams missing.
  const gradient = useMemo(() => {
    if (!activity?.altitude || !activity?.distance_m) return null;
    const len = Math.min(activity.altitude.length, activity.distance_m.length);
    if (len < 50) return null;
    return computeGradient(activity.altitude, activity.distance_m, len);
  }, [activity]);

  // CRITICAL perf: every render of CardMap was creating a fresh
  // `positions` array reference, which triggered FitBounds' useEffect
  // (deps: [map, positions]) on every hover frame → map.fitBounds()
  // re-fit on EVERY mousemove → camera thrash + repaint storm. Memo
  // the positions and everything derived from them so refs stay
  // stable while hover state churns.
  const positions = useMemo<[number, number][]>(() => {
    if (!gps || gps.length < 2) return [];
    return downsample(gps, 200).map(p => [p.lat, p.lng] as [number, number]);
  }, [gps]);

  const segments = useMemo(() => {
    if (positions.length < 2) return null;
    if (!speedKmh || speedKmh.length < 2) return null;
    return buildSegments(positions, speedKmh, 150);
  }, [positions, speedKmh]);

  // Hover overlay needs gradient sampled at the SAME index space as
  // `positions` (downsampled). Re-sample gradient onto the downsampled
  // grid so positions[i] ↔ gradientForHover[i].
  const gradientForHover = useMemo(() => {
    if (!gradient || positions.length < 2) return null;
    return positions.map((_, i) => {
      const srcIdx = Math.round((i / (positions.length - 1)) * (gradient.length - 1));
      return gradient[Math.max(0, Math.min(srcIdx, gradient.length - 1))];
    });
  }, [gradient, positions]);

  if (positions.length < 2) return <div style={{ height, background: '#f0ece4', borderRadius: 4 }} />;

  const center = positions[Math.floor(positions.length / 2)];

  // Tooltip positioning: flip below cursor when there's no room above,
  // and clamp horizontally so the box never extends past the map's
  // bounding box. With a 180px-tall card map the upper-half cursor
  // positions used to clip the tooltip — now we just swap the anchor.
  //
  // Estimated dimensions (no measurement needed for this size — the
  // tooltip is 5 fixed lines of 11pt + 6px padding, comfortably
  // ~106px tall and ~150px wide). Numbers are close enough; the
  // 6px margin on top/bottom prevents grazing the edge.
  const TT_H = 110;
  const TT_W = 160;
  const M    = 6;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const tooltipStyle: React.CSSProperties | null = (() => {
    if (!hover || !containerRef.current) return null;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const showBelow = hover.y < TT_H + M;
    let left = hover.x;
    left = Math.max(TT_W / 2 + M, Math.min(cw - TT_W / 2 - M, left));
    let top: number;
    let transform: string;
    if (showBelow) {
      top = Math.min(ch - TT_H - M, hover.y + 14);
      transform = 'translate(-50%, 0)';
    } else {
      top = hover.y - 14;
      transform = 'translate(-50%, -100%)';
    }
    return {
      position:   'absolute',
      left,
      top,
      transform,
      pointerEvents: 'none',
      zIndex:     500,
      background: tokens.surface,
      color:      tokens.ink,
      border:     `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
      padding:    '6px 8px',
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize:   11,
      lineHeight: 1.5,
      minWidth:   140,
      maxWidth:   TT_W,
      boxShadow:  '0 4px 14px rgba(0,0,0,0.18)',
      whiteSpace: 'nowrap',
    };
  })();

  return (
    <div ref={containerRef} style={{ position: 'relative', height, width: '100%' }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        dragging={false}
        zoomControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        attributionControl={false}
      >
        <BasemapTiles basemap={basemap} darkMode={dark} />
        {segments
          ? segments.map((seg, i) => (
              <Polyline key={i} positions={seg.pts} pathOptions={{ color: seg.color, weight: 3, opacity: 0.95 }} />
            ))
          : <Polyline positions={positions} pathOptions={{ color, weight: 3, opacity: 0.95 }} />
        }
        {activity && gradientForHover && (
          <HoverCatcher
            activity={activity}
            positions={positions}
            gradient={gradientForHover}
            onHover={setHover}
          />
        )}
        <FitBounds positions={positions} />
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} compact />

      {/* Custom tooltip — plain absolute-positioned div, not a Leaflet
          Popup. Renders OUTSIDE the MapContainer so the map's internal
          re-render cycle never touches it. Move = pure React state +
          one CSS transform = silky smooth. */}
      {hover && tooltipStyle && (
        <div style={tooltipStyle}>
          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: `hsl(${Math.round(Math.min(1, (hover.speed / 50)) * 120)}, 90%, 45%)`,
            }} />
            {hover.dist} km
          </div>
          <div>Pente <strong>{hover.gradient > 0 ? '+' : ''}{hover.gradient} %</strong></div>
          {hover.hr != null && <div>FC <strong>{hover.hr} bpm</strong></div>}
          <div>Vitesse <strong>{hover.speed} km/h</strong></div>
          {hover.altitude != null && <div>Altitude <strong>{hover.altitude} m</strong></div>}
        </div>
      )}
    </div>
  );
}
