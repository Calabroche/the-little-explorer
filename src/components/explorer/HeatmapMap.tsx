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

function FitAll({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [24, 24] });
    const id = setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { padding: [24, 24] }); }, 250);
    return () => clearTimeout(id);
  }, [points, map]);
  return null;
}

export function HeatmapMap({ traces, height = 560 }: { traces: { lat: number; lng: number }[][]; height?: number }) {
  const [basemap, setBasemap] = useBasemap();
  const dark = useDarkMode();

  const polylines = useMemo(
    () => traces.map(t => t.map(p => [p.lat, p.lng] as [number, number])).filter(t => t.length >= 2),
    [traces],
  );
  const allPoints = useMemo(() => polylines.flat(), [polylines]);

  if (polylines.length === 0) {
    return (
      <div style={{ height, borderRadius: 10, border: `1px solid ${tokens.creamBorder}`, background: tokens.creamDark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.inkLight, fontFamily: "'Space Grotesk'", fontSize: 13 }}>
        Pas encore de tracé GPS pour ce sport.
      </div>
    );
  }

  const center = allPoints[Math.floor(allPoints.length / 2)] ?? [46.6, 2.4];

  return (
    <div style={{ position: 'relative', height, borderRadius: 10, overflow: 'hidden', border: `1px solid ${tokens.creamBorder}` }}>
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} zoomControl scrollWheelZoom>
        <BasemapTiles basemap={basemap} darkMode={dark} />
        {polylines.map((pts, i) => (
          <Polyline key={i} positions={pts} pathOptions={{ color: tokens.terra, weight: 2.5, opacity: 0.4, lineCap: 'round', lineJoin: 'round' }} />
        ))}
        <FitAll points={allPoints} />
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} />
    </div>
  );
}
