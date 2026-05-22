'use client';

import { useEffect, useState } from 'react';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useBasemap, BasemapTiles, BasemapToggle } from './MapBasemap';

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [24, 24] });
  }, [map, positions]);
  return null;
}

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

export function RouteModalMap({
  positions, color, center,
}: {
  positions: [number, number][];
  color: string;
  center: [number, number];
}) {
  const dark = useDarkMode();
  const [basemap, setBasemap] = useBasemap();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl
        scrollWheelZoom
        attributionControl={false}
      >
        <BasemapTiles basemap={basemap} darkMode={dark} />
        {positions.length > 1 && (
          <>
            <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.9 }} />
            <FitBounds positions={positions} />
          </>
        )}
      </MapContainer>
      <BasemapToggle basemap={basemap} onChange={setBasemap} compact />
    </div>
  );
}
