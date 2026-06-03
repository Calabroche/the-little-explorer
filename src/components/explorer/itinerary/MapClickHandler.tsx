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
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Projects a geographic point to a pixel position inside the map container
// and keeps it updated as the user pans / zooms. The planner renders the
// "add this point?" confirmation as a plain React overlay *outside* the
// Leaflet layers (so clicking its buttons never registers as a map click
// and re-opens a phantom popup) — this feeds that overlay its position.
export function ClickPopupTracker({
  point,
  onMove,
}: {
  point: { lat: number; lng: number } | null;
  onMove: (px: { x: number; y: number } | null) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!point) { onMove(null); return; }
    const update = () => {
      const p = map.latLngToContainerPoint([point.lat, point.lng]);
      onMove({ x: p.x, y: p.y });
    };
    update();
    map.on('move zoom zoomanim viewreset resize', update);
    return () => { map.off('move zoom zoomanim viewreset resize', update); };
  }, [point, map, onMove]);
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
