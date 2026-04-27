'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [24, 24] });
  }, [map, positions]);
  return null;
}

const VOYAGER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export function RouteModalMap({
  positions, color, center,
}: {
  positions: [number, number][];
  color: string;
  center: [number, number];
}) {
  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
      zoomControl
      scrollWheelZoom
      attributionControl={false}
    >
      <TileLayer url={VOYAGER} />
      {positions.length > 1 && (
        <>
          <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.9 }} />
          <FitBounds positions={positions} />
        </>
      )}
    </MapContainer>
  );
}
