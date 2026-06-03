'use client';

import { useMapEvents } from 'react-leaflet';

// Tiny headless child of <MapContainer>: subscribes to Leaflet's `click`
// event and bubbles the geo-coordinates up to the planner. Lives in its
// own file so it can be `dynamic(..., { ssr: false })`-imported like the
// other react-leaflet pieces (the hook touches `window` at import time).
export function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}
