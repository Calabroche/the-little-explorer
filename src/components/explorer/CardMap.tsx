'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polyline, Popup, useMap } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, tokens } from './tokens';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';

// CardMap is an embedded preview inside each ActivityCard on the feed.
// It does carry a compact Plan/Sat toggle (top-right of the preview)
// because users land here first — flipping a single card from the feed
// also updates the global preference via `useBasemap`, so the activity
// detail map opens in the same style afterwards.
//
// When the parent passes the full `activity` prop, we also enable the
// hover tooltip used on the activity-detail map (distance along route,
// slope, speed, HR, power, altitude) — the user wanted the same data
// reachable directly from the feed without clicking into the ride.

// ── Physics for power estimation at a point ──────────────────────────────
// Same constants as ActivityRouteMap (kept inline to avoid a circular
// import — both files use these but neither owns them). 74 kg total mass
// is a reasonable middle ground; we can wire user.settings.totalMass
// later if hover power becomes mission-critical.
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
    if (positions.length > 1) map.fitBounds(positions, { padding: [6, 6] });
  }, [map, positions]);
  return null;
}

function downsample(pts: { lat: number; lng: number }[], max: number) {
  const step = Math.max(1, Math.floor(pts.length / max));
  return pts.filter((_, i) => i % step === 0);
}

// ── Hover tooltip overlay (rendered only when `activity` is passed) ──────

interface HoverData {
  latlng:   { lat: number; lng: number };
  dist:     number;
  hr:       number | null;
  speed:    number | null;
  power:    number;
  altitude: number | null;
  gradient: number;
}

/**
 * Invisible-thick polyline that captures mousemove to surface
 * the point-by-point metrics in a Popup. Mirrors the activity-detail
 * map's hover behaviour so users get the same insight directly from
 * the feed card without drilling into the ride.
 *
 * Uses the original full-resolution streams from the activity (not
 * the downsampled positions array used for rendering), so the index
 * lookup picks the closest GPS point at native sample rate.
 */
function HoverOverlay({ activity, positions, gradient }: {
  activity: Activity;
  positions: [number, number][];
  gradient: number[];
}) {
  const [info, setInfo] = useState<HoverData | null>(null);

  const handleMouseMove = (e: LeafletMouseEvent) => {
    const { lat, lng } = e.latlng;
    // Two-pass nearest-neighbour: coarse stride-5 sweep then a
    // ±10-sample refinement. Avoids walking ~1k points on every
    // mouse move while staying accurate.
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
    const speedKmh = activity.speed_kmh?.[nearestIdx] ?? 0;
    const speedMs  = speedKmh / 3.6;
    const grad     = gradient[nearestIdx] ?? 0;
    setInfo({
      latlng:   { lat: e.latlng.lat, lng: e.latlng.lng },
      dist:     +((activity.distance_m?.[nearestIdx] ?? 0) / 1000).toFixed(2),
      hr:       activity.heartrate?.[nearestIdx] ?? null,
      speed:    +speedKmh.toFixed(1),
      power:    calcPowerAt(speedMs, grad),
      altitude: activity.altitude?.[nearestIdx] != null ? Math.round(activity.altitude![nearestIdx]) : null,
      gradient: +grad.toFixed(1),
    });
  };

  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{ color: 'transparent', weight: 14, opacity: 0.01 }}
        eventHandlers={{ mousemove: handleMouseMove, mouseout: () => setInfo(null) }}
      />
      {info && (
        <Popup
          position={[info.latlng.lat, info.latlng.lng]}
          offset={[0, -10]}
          closeButton={false}
          autoClose={false}
          closeOnClick={false}
        >
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11, minWidth: 150, lineHeight: 1.7, background: tokens.surface, color: tokens.ink, padding: 6, borderRadius: 4 }}>
            <div style={{ fontWeight: 700, marginBottom: 3, fontSize: 10, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: info.speed != null ? `hsl(${Math.round(Math.min(1, (info.speed / 50)) * 120)}, 90%, 45%)` : tokens.terra,
              }} />
              {info.dist} km · pente {info.gradient > 0 ? '+' : ''}{info.gradient}%
            </div>
            {info.hr != null && <div>FC : <strong>{info.hr} bpm</strong></div>}
            <div>Vitesse : <strong>{info.speed} km/h</strong></div>
            <div>Puissance : <strong>{info.power} W</strong></div>
            {info.altitude != null && <div>Altitude : <strong>{info.altitude} m</strong></div>}
          </div>
        </Popup>
      )}
    </>
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

  // The hover tooltip uses the ORIGINAL streams (full resolution), but
  // the polyline that captures hover events needs to use the downsampled
  // positions for rendering perf. So we keep the index mapping aligned
  // by computing gradient on the original altitude/distance_m arrays.
  const gradient = useMemo(() => {
    if (!activity?.altitude || !activity?.distance_m) return null;
    const len = Math.min(activity.altitude.length, activity.distance_m.length);
    if (len < 50) return null;
    return computeGradient(activity.altitude, activity.distance_m, len);
  }, [activity]);

  if (!gps || gps.length < 2) return <div style={{ height, background: '#f0ece4', borderRadius: 4 }} />;

  // Downsampled for rendering speed. Hover events still target the
  // visible polyline; the nearest-neighbour search inside HoverOverlay
  // uses the SAME downsampled positions so the indices line up.
  const sampled   = downsample(gps, 200);
  const positions = sampled.map(p => [p.lat, p.lng] as [number, number]);
  const center    = positions[Math.floor(positions.length / 2)];
  const segments  = speedKmh && speedKmh.length > 1
    ? buildSegments(positions, speedKmh, 150)
    : null;

  // Hover overlay needs gradient sampled at the SAME index space as
  // `positions` (downsampled). Re-sample gradient onto the downsampled
  // grid so positions[i] ↔ gradientForHover[i].
  const gradientForHover = useMemo(() => {
    if (!gradient) return null;
    return positions.map((_, i) => {
      const srcIdx = Math.round((i / (positions.length - 1)) * (gradient.length - 1));
      return gradient[Math.max(0, Math.min(srcIdx, gradient.length - 1))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradient, positions.length]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        // Hover tooltip + Plan/Sat toggle benefit from a tiny bit of
        // interactivity (drag, scroll, double-click) without it
        // feeling like a full mini-map. dragging stays off so the
        // user can't accidentally pan the preview while scrolling
        // the feed. zoomControl off keeps the corner clean.
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
          <HoverOverlay activity={activity} positions={positions} gradient={gradientForHover} />
        )}
        <FitBounds positions={positions} />
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} compact />
    </div>
  );
}
