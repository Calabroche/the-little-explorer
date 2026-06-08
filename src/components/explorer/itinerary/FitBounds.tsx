'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Tiny helper component: whenever `positions` changes, fit the Leaflet map
// view to the bounding box of those points (with a bit of padding). Lives
// inside <MapContainer> so it can grab the map instance via useMap().
//
// Lazy-imported via next/dynamic in the parent because react-leaflet's
// useMap() hook touches `window` at import time.
export function FitBounds({ positions, zoomPercent = 100 }: { positions: [number, number][] | null; zoomPercent?: number }) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length === 0) return;
    // % → Leaflet zoom-level offset applied on top of the fit (100% = none).
    // Fractional so 110/115/120 differ — needs zoomSnap={0} on the map.
    const offset = (zoomPercent - 100) / 25;
    if (positions.length === 1) {
      map.setView(positions[0], 13 + offset);
      return;
    }
    const lats = positions.map(p => p[0]);
    const lngs = positions.map(p => p[1]);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    map.fitBounds(bounds, { padding: [40, 40], animate: false });
    if (offset !== 0) map.setZoom(map.getZoom() + offset, { animate: false });
  }, [positions, map, zoomPercent]);
  return null;
}
