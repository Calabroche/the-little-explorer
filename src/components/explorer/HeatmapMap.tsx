'use client';

/**
 * Personal heatmap — every GPS trace you've recorded overlaid as low-opacity
 * lines on one map. Where you ride often, the lines stack and glow. No heat
 * library needed: overlapping semi-transparent polylines give the effect and
 * stay dependency-free.
 */
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';
import { tokens } from './tokens';

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.hasAttribute('data-dark'));
    const obs = new MutationObserver(() => setDark(document.documentElement.hasAttribute('data-dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Bounds of the dense 94% of points — a lone ride far away no longer zooms the
 *  whole map out; we frame where you actually ride. */
function clusterBounds(points: [number, number][]): L.LatLngBounds | null {
  if (points.length < 2) return null;
  const lats = points.map(p => p[0]).sort((a, b) => a - b);
  const lngs = points.map(p => p[1]).sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
  return L.latLngBounds([q(lats, 0.03), q(lngs, 0.03)], [q(lats, 0.97), q(lngs, 0.97)]);
}

function FitAll({ points, resizeKey }: { points: [number, number][]; resizeKey: unknown }) {
  const map = useMap();
  useEffect(() => {
    const bounds = clusterBounds(points);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [28, 28] });
    const id = setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { padding: [28, 28] }); }, 220);
    return () => clearTimeout(id);
  }, [points, map, resizeKey]);
  return null;
}

export function HeatmapMap({ traces }: { traces: { lat: number; lng: number }[][] }) {
  const [basemap, setBasemap] = useBasemap();
  const dark = useDarkMode();
  const [full, setFull] = useState(false);

  const polylines = useMemo(
    () => traces.map(t => t.map(p => [p.lat, p.lng] as [number, number])).filter(t => t.length >= 2),
    [traces],
  );
  const allPoints = useMemo(() => polylines.flat(), [polylines]);

  // Escape closes fullscreen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  if (polylines.length === 0) {
    return (
      <div style={{ height: '100%', minHeight: 320, borderRadius: 10, border: `1px solid ${tokens.creamBorder}`, background: tokens.creamDark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.inkLight, fontFamily: "'Space Grotesk'", fontSize: 13 }}>
        Pas encore de tracé GPS pour ce sport.
      </div>
    );
  }

  const center = allPoints[Math.floor(allPoints.length / 2)] ?? [46.6, 2.4];

  const wrapStyle: React.CSSProperties = full
    ? { position: 'fixed', inset: 0, zIndex: 4000, borderRadius: 0, border: 'none' }
    : { position: 'relative', height: '100%', minHeight: 360, borderRadius: 10, overflow: 'hidden', border: `1px solid ${tokens.creamBorder}` };

  return (
    <div style={wrapStyle}>
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} zoomControl scrollWheelZoom>
        <BasemapTiles basemap={basemap} darkMode={dark} />
        {polylines.map((pts, i) => (
          <Polyline key={i} positions={pts} pathOptions={{ color: tokens.terra, weight: 2.5, opacity: 0.4, lineCap: 'round', lineJoin: 'round' }} />
        ))}
        <FitAll points={allPoints} resizeKey={full} />
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} />
      {/* Fullscreen toggle — same affordance as the activity route map. */}
      <button
        onClick={() => setFull(f => !f)}
        title={full ? 'Réduire' : 'Plein écran'}
        style={{
          position: 'absolute', top: 12, left: 52, zIndex: 4001,
          width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          color: tokens.inkMid, fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >{full ? '✕' : '⤢'}</button>
    </div>
  );
}
