'use client';

import { useEffect } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

// Tiny headless child of <MapContainer>: subscribes to Leaflet's `click`
// event and bubbles the geo-coordinates up to the planner. Lives in its
// own file so it can be `dynamic(..., { ssr: false })`-imported like the
// other react-leaflet pieces (the hook touches `window` at import time).
export function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      // Clicks on our confirmation popup (the "Ajouter" / ✕ buttons) bubble
      // up to the map and would otherwise be read as a fresh map click —
      // re-opening a phantom popup elsewhere. Ignore anything originating
      // inside a Leaflet popup; only true map-background clicks add a point.
      const target = e.originalEvent?.target as HTMLElement | null;
      if (target?.closest?.('.leaflet-popup')) return;
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Keeps Leaflet's internal canvas in sync when the map container is
// resized by the layout (e.g. the map column grows once the way-type card
// or elevation profile loads). Without this, the newly-exposed area shows
// blank grey tiles until the next pan/zoom.
export function MapAutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}
