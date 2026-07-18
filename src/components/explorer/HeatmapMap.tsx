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

/** Frame where you actually ride: keep the 82% of points closest to the median
 *  centre and fit to those. A handful of far-away rides (e.g. a trip to Dijon)
 *  are dropped, so the default view lands tight on your main area (Lyon). */
function clusterBounds(points: [number, number][]): L.LatLngBounds | null {
  if (points.length < 2) return null;
  const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const cLat = median(points.map(p => p[0]));
  const cLng = median(points.map(p => p[1]));
  const kx = Math.cos((cLat * Math.PI) / 180); // longitude scaling at this latitude
  const byDist = points
    .map(p => ({ p, d: (p[0] - cLat) ** 2 + ((p[1] - cLng) * kx) ** 2 }))
    .sort((a, b) => a.d - b.d);
  const keep = byDist.slice(0, Math.max(2, Math.floor(byDist.length * 0.70))).map(x => x.p);
  return L.latLngBounds(keep);
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

  // Initial centre = the spatial median (your home area) so the very first
  // paint is already on the cluster, before FitAll refines the bounds.
  const center: [number, number] = allPoints.length
    ? [
        [...allPoints.map(p => p[0])].sort((a, b) => a - b)[Math.floor(allPoints.length / 2)],
        [...allPoints.map(p => p[1])].sort((a, b) => a - b)[Math.floor(allPoints.length / 2)],
      ]
    : [46.6, 2.4];

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
      {/* Fullscreen toggle — labeled pill, bottom-left so it never collides
          with the zoom control or the basemap toggle. */}
      <button
        onClick={() => setFull(f => !f)}
        style={{
          position: 'absolute', bottom: 14, left: 12, zIndex: 4001,
          padding: '8px 14px', borderRadius: 999, cursor: 'pointer', border: 'none',
          // High contrast against the map: white in dark mode, black in light mode.
          background: dark ? '#ffffff' : '#141414',
          color: dark ? '#141414' : '#ffffff',
          fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        }}
      >
        <span style={{ fontSize: 14 }}>{full ? '✕' : '⤢'}</span>
        {full ? 'Réduire' : 'Agrandir la carte'}
      </button>
    </div>
  );
}
