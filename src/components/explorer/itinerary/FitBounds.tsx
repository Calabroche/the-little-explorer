'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Tiny helper component: whenever `positions` changes, fit the Leaflet map
// view to the bounding box of those points (with a bit of padding). Lives
// inside <MapContainer> so it can grab the map instance via useMap().
//
// Lazy-imported via next/dynamic in the parent because react-leaflet's
// useMap() hook touches `window` at import time.
export function FitBounds({ positions }: { positions: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 13);
      return;
    }
    const lats = positions.map(p => p[0]);
    const lngs = positions.map(p => p[1]);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [positions, map]);
  return null;
}
