'use client';

import { useEffect, useState } from 'react';
import { MapContainer, Polyline, Popup, useMap } from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, tokens } from './tokens';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';

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

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) {
      // Fit to bounds, then bump the zoom level by +1 so the route
      // fills more of the card. Default fitBounds leaves a lot of
      // padding around long rides; a single zoom step is enough to
      // close the gap without cropping the polyline.
      map.fitBounds(positions, { padding: [16, 16] });
      const currentZoom = map.getZoom();
      map.setZoom(Math.min(currentZoom + 1, 16));
    }
  }, [map, positions]);
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
          position={[info.latlng.lat, info.latlng.lng]}
          offset={[0, -10]}
          closeButton={false}
          autoClose={false}
          closeOnClick={false}
        >
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 12, minWidth: 170, lineHeight: 1.9, background: tokens.surface, color: tokens.ink, padding: 8, borderRadius: 4 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 11, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: info.speed != null ? `hsl(${Math.round(Math.min(1, (info.speed / 50)) * 120)}, 90%, 45%)` : tokens.terra }} />
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

export function ActivityRouteMap({
  activity,
  highlightSegment,
}: {
  activity: Activity;
  /** Optional climb / segment to highlight on top of the base route.
   *  Indices are into the activity's altitude/distance streams; we
   *  clamp into the GPS array's bounds defensively in case Strava
   *  returned mismatched stream lengths. Used by the Climbs card on
   *  the parent AnalysisPage when the user hovers a climb row. */
  highlightSegment?: { startIdx: number; endIdx: number } | null;
}) {
  const dark = useDarkMode();
  const [basemap, setBasemap] = useBasemap();
  const { gps, altitude = [], distance_m = [] } = activity;
  if (!gps || gps.length < 2) return null;

  const len       = Math.min(gps.length, altitude.length, distance_m.length);
  const gradient  = computeGradient(altitude, distance_m, len);
  const positions = gps.map(p => [p.lat, p.lng] as [number, number]);
  const center    = positions[Math.floor(positions.length / 2)];

  return (
    <div style={{ position: 'relative' }}>
      <MapContainer
        center={center}
        zoom={12}
        // 480px — trimmed from the previous 810 now that the Climbs
        // card sits above the map. Less scroll, and the highlighted
        // climb segment still reads clearly at this height.
        style={{ height: 480, width: '100%', borderRadius: 4 }}
        scrollWheelZoom={false}
      >
        <BasemapTiles basemap={basemap} darkMode={dark} />
        <RouteWithHover
          activity={activity}
          positions={positions}
          gradient={gradient}
          highlightSegment={highlightSegment ?? null}
        />
        <FitBounds positions={positions} />
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} />
    </div>
  );
}
