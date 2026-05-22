'use client';

/**
 * Shared basemap layer + toggle for every Leaflet map in the app.
 *
 * Why centralise:
 *   - 7 different map components were each hardcoding their own
 *     TileLayer URL. Adding the satellite option would have meant 7
 *     near-identical patches. Now: one source of truth, one toggle UI,
 *     one localStorage key.
 *   - User preference (plan vs satellite) propagates across every map:
 *     pick satellite on the Map page, the next activity-detail map you
 *     open will start in satellite too.
 *
 * Tile sources:
 *   - `plan` (light)    → CARTO Positron (clean editorial look,
 *                         matches the app's palette)
 *   - `plan` (dark)     → CARTO Dark + labels overlay (two layers
 *                         stacked, "labels" sits on top so they stay
 *                         readable against the dark base)
 *   - `satellite`       → Esri World Imagery (free, no API key, broad
 *                         global coverage, good resolution down to
 *                         street level in France)
 *
 * Satellite mode in dark theme: the satellite tiles are already dark,
 * so we don't apply a separate "dark satellite" — same tiles either
 * way. Labels are overlaid in dark-mode-friendly white.
 *
 * Note on react-leaflet imports: kept static (not dynamic) since this
 * component is `'use client'` and only renders client-side anyway. Maps
 * that historically used dynamic() for SSR safety still work — they
 * just import this component normally.
 */

import { ComponentType, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { tokens } from './tokens';

// `react-leaflet` references `window` at module load — `dynamic({ ssr:false })`
// keeps it out of the SSR bundle. Without this, pre-rendering any page
// that statically imports a map component fails with "window is not
// defined" on the server. We re-type the dynamic result so callers get
// proper prop typing on `url`, `attribution`, etc.
interface TileLayerProps {
  url:           string;
  attribution?:  string;
  maxZoom?:      number;
  maxNativeZoom?: number;
  key?:          string;
}
const TileLayer = dynamic(
  () => import('react-leaflet').then(m => m.TileLayer),
  { ssr: false },
) as unknown as ComponentType<TileLayerProps>;

export type BasemapStyle = 'plan' | 'satellite';

const STORAGE_KEY = 'tle_basemap_v1';

// ── Tile URLs ──────────────────────────────────────────────────────────────

const PLAN_LIGHT       = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
const PLAN_DARK_BASE   = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png';
const PLAN_DARK_LABELS = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png';
const SATELLITE        = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Light labels overlay on top of satellite — uses CARTO's "only_labels"
// which has no base map, just road names + city labels.
const SATELLITE_LABELS = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png';

const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const ESRI_ATTRIBUTION  = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Returns the current basemap preference + a setter. Persisted to
 * localStorage so the choice survives page reloads and propagates
 * across every map in the app.
 */
export function useBasemap(): [BasemapStyle, (v: BasemapStyle) => void] {
  const [basemap, setBasemap] = useState<BasemapStyle>('plan');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'plan' || stored === 'satellite') setBasemap(stored);
    } catch {
      // localStorage can throw in private-mode Safari etc.
    }
  }, []);

  const set = useCallback((v: BasemapStyle) => {
    setBasemap(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // ignored
    }
  }, []);

  return [basemap, set];
}

// ── Tile layers ────────────────────────────────────────────────────────────

/**
 * Render the right TileLayer(s) for the given basemap + theme. Drop
 * this inside any <MapContainer> — it replaces whatever <TileLayer />
 * markup the map had before.
 *
 * Re-keying on the basemap value (key={basemap}) forces React to
 * unmount/remount the layers when the user toggles. Without that,
 * Leaflet sometimes paints both layers stacked instead of swapping.
 */
export function BasemapTiles({ basemap, darkMode = false }: {
  basemap: BasemapStyle;
  darkMode?: boolean;
}) {
  if (basemap === 'satellite') {
    return (
      <>
        <TileLayer key={`sat-${darkMode}`} url={SATELLITE} attribution={ESRI_ATTRIBUTION} />
        <TileLayer key={`sat-labels-${darkMode}`} url={SATELLITE_LABELS} />
      </>
    );
  }
  // Plan
  if (darkMode) {
    return (
      <>
        <TileLayer key="plan-dark-base"   url={PLAN_DARK_BASE}   attribution={CARTO_ATTRIBUTION} />
        <TileLayer key="plan-dark-labels" url={PLAN_DARK_LABELS} />
      </>
    );
  }
  return <TileLayer key="plan-light" url={PLAN_LIGHT} attribution={CARTO_ATTRIBUTION} />;
}

// ── Toggle UI ──────────────────────────────────────────────────────────────

/**
 * Floating pill control to switch between Plan and Satellite. Drop
 * this on top of any map (outside <MapContainer>, in the same
 * positioned wrapper) — defaults to top-right with a 12px inset.
 *
 * Click events DON'T propagate through Leaflet (we stopPropagation +
 * a small `leaflet-control` class trick) so dragging on top of the
 * toggle doesn't pan the map.
 */
export function BasemapToggle({
  basemap,
  onChange,
  position = 'top-right',
  compact = false,
}: {
  basemap:   BasemapStyle;
  onChange:  (v: BasemapStyle) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  compact?:  boolean;
}) {
  const [top, right, bottom, left] = ({
    'top-right':    [12,  12, undefined, undefined],
    'top-left':     [12,  undefined, undefined, 12],
    'bottom-right': [undefined, 12, 12, undefined],
    'bottom-left':  [undefined, undefined, 12, 12],
  } as const)[position];

  const pillStyle: React.CSSProperties = {
    position:  'absolute',
    top, right, bottom, left,
    zIndex:    1000,
    background: tokens.surface,
    border:     `1px solid ${tokens.creamBorder}`,
    borderRadius: 999,
    padding:    2,
    display:    'flex',
    gap:        2,
    boxShadow:  '0 2px 6px rgba(0,0,0,0.15)',
    pointerEvents: 'auto',
  };

  const optionStyle = (active: boolean): React.CSSProperties => ({
    padding:       compact ? '4px 10px' : '6px 14px',
    background:    active ? tokens.ink : 'transparent',
    color:         active ? tokens.surface : tokens.inkMid,
    border:        'none',
    borderRadius:  999,
    cursor:        'pointer',
    fontFamily:    "'Space Grotesk'",
    fontSize:      compact ? 10 : 11,
    fontWeight:    700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  });

  return (
    <div
      style={pillStyle}
      // Keep Leaflet from interpreting clicks/drags on the toggle as map drags
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onChange('plan')}
        style={optionStyle(basemap === 'plan')}
      >
        Plan
      </button>
      <button
        type="button"
        onClick={() => onChange('satellite')}
        style={optionStyle(basemap === 'satellite')}
      >
        Sat.
      </button>
    </div>
  );
}
