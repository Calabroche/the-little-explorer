'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// When the sport filter changes, fly the camera to the new centroid of
// start points with a span sized to how spread those starts are. Leaflet
// `flyTo` uses an easing animation so the recenter doesn't snap.
export function RecenterCamera({ center, spanDeg }: { center: [number, number]; spanDeg: number }) {
  const map = useMap();
  useEffect(() => {
    // Approx degrees → zoom level via Leaflet's standard conversion.
    // World fits ~360° at zoom 0; halving span → +1 zoom. We aim for a
    // 13km-ish min span (~0.12°) so the neighbourhood is always
    // visible even when starts cluster tightly.
    const safeSpan = Math.max(0.08, spanDeg);
    const zoom = Math.max(10, Math.min(14, Math.round(Math.log2(360 / safeSpan)) - 1));
    map.flyTo(center, zoom, { animate: true, duration: 0.8 });
  }, [center[0], center[1], spanDeg, map]);
  return null;
}
