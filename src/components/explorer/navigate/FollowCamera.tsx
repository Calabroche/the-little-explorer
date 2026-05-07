'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Pans the map to keep the user near the centre as they move. Uses
// `panTo` (smooth) instead of `setView` so the camera glides instead of
// snapping. Lazy-loaded via next/dynamic from the parent because
// useMap touches `window`.
export function FollowCamera({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lng], { animate: true, duration: 0.6 });
  }, [lat, lng, map]);
  return null;
}
