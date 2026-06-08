'use client';

import { useState, useEffect, useCallback } from 'react';
import { tokens } from './tokens';

// Shared map zoom-% control (the pill + persisted level) used by the activity
// route map and the itinerary planner so they behave identically and share
// the chosen level across maps.
export const ZOOM_PERCENT_KEY = 'tle_map_zoom_percent_v1';
export const ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200];

// Leaflet zoom offset applied on top of fitBounds for a given %.
export function zoomOffsetFromPercent(percent: number): number {
  return Math.round((percent - 100) / 25);
}

export function useZoomPercent(): [number, (v: number) => void] {
  const [percent, setPercentState] = useState<number>(100);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(ZOOM_PERCENT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && ZOOM_OPTIONS.includes(parsed)) setPercentState(parsed);
  }, []);
  const setPercent = useCallback((v: number) => {
    setPercentState(v);
    if (typeof window !== 'undefined') window.localStorage.setItem(ZOOM_PERCENT_KEY, String(v));
  }, []);
  return [percent, setPercent];
}

/** Pill UI, placed to the right of Leaflet's +/- control by default. */
export function ZoomPercentPill({
  value,
  onChange,
  left = 50,
  top = 12,
}: {
  value: number;
  onChange: (v: number) => void;
  left?: number;
  top?: number;
}) {
  return (
    <div
      style={{
        position: 'absolute', top, left, zIndex: 1100,
        background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
        borderRadius: 999, padding: '2px 4px',
        display: 'flex', alignItems: 'center', gap: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)', pointerEvents: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <span style={{
        fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        color: tokens.inkLight, textTransform: 'uppercase', padding: '0 6px',
      }}>Zoom</span>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          background: 'transparent', border: 'none', borderRadius: 999, padding: '4px 6px',
          fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700, color: tokens.ink,
          cursor: 'pointer', appearance: 'none',
        }}
      >
        {ZOOM_OPTIONS.map(p => <option key={p} value={p}>{p}%</option>)}
      </select>
    </div>
  );
}
