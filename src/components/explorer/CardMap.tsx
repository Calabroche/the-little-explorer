'use client';

import { useEffect, useState } from 'react';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';

// CardMap is an embedded preview inside each ActivityCard on the feed.
// It does carry a compact Plan/Sat toggle (top-right of the preview)
// because users land here first — flipping a single card from the feed
// also updates the global preference via `useBasemap`, so the activity
// detail map opens in the same style afterwards.

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

export function CardMap({
  gps, color, height = 180, speedKmh,
}: {
  gps: { lat: number; lng: number }[];
  color: string;
  height?: number | string;
  speedKmh?: number[];
}) {
  const dark = useDarkMode();
  const [basemap, setBasemap] = useBasemap();
  if (!gps || gps.length < 2) return <div style={{ height, background: '#f0ece4', borderRadius: 4 }} />;

  const sampled   = downsample(gps, 200);
  const positions = sampled.map(p => [p.lat, p.lng] as [number, number]);
  const center    = positions[Math.floor(positions.length / 2)];
  const segments  = speedKmh && speedKmh.length > 1
    ? buildSegments(positions, speedKmh, 150)
    : null;

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
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
        <FitBounds positions={positions} />
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} compact />
    </div>
  );
}
