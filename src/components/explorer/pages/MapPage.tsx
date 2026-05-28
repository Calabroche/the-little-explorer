'use client';

/**
 * Heatmap — every GPS track stacked on one map, low-opacity polylines
 * so overlapping rides accumulate visually into a density "heatmap"
 * (a street ridden once is faint, a street ridden 20 times is solid).
 *
 * Why polylines + low opacity instead of a `leaflet.heat`-style point
 * heatmap: our data is already polyline-shaped (consecutive GPS
 * samples), and stacked semi-transparent strokes give a much more
 * legible "where the route goes" than a blurred dot cloud. Same trick
 * Strava uses for its global heatmap.
 *
 * Filters: sport (independent from the global sidebar pick so the user
 * can browse all sports' routes from the cycling view), year, and bike
 * (when sport=cycling and ≥2 bikes are present). All three stack.
 *
 * The old "single activity inspector" branch of this page (when a
 * caller passed a `selectedActivity` prop) is gone — no UI exposes it
 * and the ActivityCard's own embedded map handles the per-ride detail.
 */

import { useEffect, useMemo, useState, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens, Activity } from '../tokens';
import { SectionTag, Label } from '../ui';
import { useT } from '@/i18n';
import { SportId } from '../Sidebar';
import { useBasemap, BasemapToggle } from '../MapBasemap';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(mod => mod.Polyline),     { ssr: false });
const BasemapTiles = dynamic(() => import('../MapBasemap').then(m => m.BasemapTiles), { ssr: false });
// Lazy-loaded because react-leaflet pokes at `window` at import time.
const RecenterCamera = dynamic(() => import('../MapCamera').then(m => m.RecenterCamera), { ssr: false });

interface Props {
  activities: Activity[];
  // Kept in the prop bag for API stability with ExplorerApp's router,
  // but the page no longer reads it — the heatmap is always
  // multi-activity.
  selectedActivity: Activity | null;
}

const SPORT_COLOR: Record<SportId, string> = {
  cycling:  tokens.terra,
  running:  tokens.green,
  hiking:   tokens.green,
  ski:      tokens.blue,
  snowshoe: tokens.blue,
  walking:  tokens.inkMid,
  swim:     tokens.blue,
};
const SPORT_ICON: Record<SportId, string> = {
  cycling: '◎', running: '⌒', hiking: '▲', ski: '⛷', snowshoe: '❄', walking: '⋯', swim: '≈',
};
const SPORT_ORDER: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];

// Dardilly fallback — first load before activities arrive doesn't
// drop the camera into a black ocean. Matches iOS.
const DARDILLY: [number, number] = [45.81, 4.75];

const ALL_YEARS = 'all';

export function MapPage({ activities }: Props) {
  const { t } = useT();
  const [basemap, setBasemap] = useBasemap();
  const darkMode = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-dark');

  // Only activities with GPS data are eligible for the map.
  const withGps = useMemo(() => activities.filter(a => a.gps && a.gps.length > 1), [activities]);

  // Sports actually present in the GPS data → drives the sport chip filter.
  const availableSports = useMemo(() => {
    const present = new Set(withGps.map(a => a.type as SportId));
    return SPORT_ORDER.filter(s => present.has(s));
  }, [withGps]);

  const [sport, setSport] = useState<SportId>('cycling');
  useEffect(() => {
    if (availableSports.length === 0) return;
    if (!availableSports.includes(sport)) setSport(availableSports[0]);
  }, [availableSports, sport]);

  // Years actually present in the GPS data — drives the year picker.
  // We always keep "Toutes les années" as the implicit default.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const a of withGps) {
      const d = a.rawDate ?? '';
      const y = parseInt(d.slice(0, 4), 10);
      if (Number.isFinite(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);   // most recent first
  }, [withGps]);
  const [year, setYear] = useState<string>(ALL_YEARS);

  // Bike filter — only meaningful for cycling. Derived from the sport-
  // filtered subset so we don't surface bikes the user has never
  // ridden under the current sport.
  const bikesSeen = useMemo(() => {
    if (sport !== 'cycling') return [];
    const map = new Map<string, string>();
    for (const a of withGps) {
      if (a.type === 'cycling' && a.gear_id && a.gear_name) map.set(a.gear_id, a.gear_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [withGps, sport]);
  const [bikeFilter, setBikeFilter] = useState<string | null>(null);
  // Reset bike filter whenever the sport switches away from cycling.
  useEffect(() => { if (sport !== 'cycling') setBikeFilter(null); }, [sport]);

  const filtered = useMemo(() => withGps.filter(a => {
    if (a.type !== sport) return false;
    if (year !== ALL_YEARS && !(a.rawDate ?? '').startsWith(year)) return false;
    if (bikeFilter && a.gear_id !== bikeFilter) return false;
    return true;
  }), [withGps, sport, year, bikeFilter]);

  // Camera: centroid of the start points + a span that scales with
  // how spread the departures are (sensible floor to keep zoom usable).
  const centroid = useMemo<{ center: [number, number]; spanDeg: number }>(() => {
    const starts = filtered
      .map(a => a.gps[0])
      .filter((p): p is { lat: number; lng: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (starts.length === 0) return { center: DARDILLY, spanDeg: 0.12 };
    const lats = starts.map(p => p.lat);
    const lngs = starts.map(p => p.lng);
    const cLat = lats.reduce((s, v) => s + v, 0) / lats.length;
    const cLng = lngs.reduce((s, v) => s + v, 0) / lngs.length;
    const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    return { center: [cLat, cLng], spanDeg: Math.max(0.08, spread * 1.5) };
  }, [filtered]);

  // Density stats — surfaced in the legend so the user knows what the
  // map represents quantitatively (rides shown, total km, total hours).
  const stats = useMemo(() => {
    const km    = Math.round(filtered.reduce((s, a) => s + (a.distance ?? 0), 0));
    const mins  = filtered.reduce((s, a) => s + (a.duration_min ?? 0), 0);
    const hours = Math.round(mins / 60);
    return { count: filtered.length, km, hours };
  }, [filtered]);

  const color = SPORT_COLOR[sport] ?? tokens.terra;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Header />
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={centroid.center}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
          maxZoom={18}
        >
          <BasemapTiles basemap={basemap} darkMode={darkMode} />
          {/* Heatmap rendering: low-opacity stacked polylines. Overlap
              accumulates visually so the streets the user rides often
              go nearly opaque. Thin weight keeps everything legible
              even when 100s of tracks pile up. */}
          {filtered.map((a, i) => (
            <Polyline
              key={a.id ?? i}
              positions={a.gps.map(p => [p.lat, p.lng])}
              pathOptions={{ color, weight: 1.8, opacity: 0.12 }}
              interactive={false}     // no per-track click — perf + clarity
            />
          ))}
          <RecenterCamera center={centroid.center} spanDeg={centroid.spanDeg} />
        </MapContainer>
        <BasemapToggle basemap={basemap} onChange={setBasemap} />

        {/* Sport picker — top-left */}
        {availableSports.length > 1 && (
          <div style={pickerStyle}>
            {availableSports.map(s => {
              const active = s === sport;
              return (
                <button key={s} onClick={() => setSport(s)}
                  style={{
                    padding: '6px 10px', borderRadius: 14, border: 'none',
                    background: active ? SPORT_COLOR[s] : tokens.creamDark,
                    color: active ? '#fff' : tokens.inkMid,
                    fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: active ? 700 : 500,
                    letterSpacing: '0.05em', whiteSpace: 'nowrap', cursor: 'pointer',
                  }}>
                  <span style={{ marginRight: 6 }}>{SPORT_ICON[s]}</span>{t(`type.${s}`)}
                </button>
              );
            })}
          </div>
        )}

        {/* Density / stats legend — top-right.
            Wraps the dynamic year + bike filters underneath so all the
            "what am I looking at" controls live in one place. */}
        <div style={legendStyle}>
          <Label style={{ display: 'block', marginBottom: 6 }}>HEATMAP</Label>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 20, height: 2.5, background: color, borderRadius: 2, alignSelf: 'center' }} />
            <span style={{
              fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 800, color: tokens.ink,
            }}>{stats.count}</span>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid }}>
              sortie{stats.count > 1 ? 's' : ''}
            </span>
          </div>
          <div style={{
            display: 'flex', gap: 12, fontFamily: "'Space Grotesk'", fontSize: 11,
            color: tokens.inkLight, marginBottom: 12,
          }}>
            <span><strong style={{ color: tokens.ink }}>{stats.km}</strong> km</span>
            <span><strong style={{ color: tokens.ink }}>{stats.hours}</strong> h</span>
          </div>

          {/* Year picker (compact dropdown). Empty / single-year users
              don't see it. */}
          {availableYears.length > 1 && (
            <div style={{ marginBottom: bikesSeen.length >= 2 ? 10 : 0 }}>
              <Label style={{ display: 'block', marginBottom: 4 }}>ANNÉE</Label>
              <select
                value={year}
                onChange={e => setYear(e.target.value)}
                style={selectStyle}
              >
                <option value={ALL_YEARS}>Toutes</option>
                {availableYears.map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {/* Bike picker — cycling-only, ≥2 bikes only. */}
          {sport === 'cycling' && bikesSeen.length >= 2 && (
            <div>
              <Label style={{ display: 'block', marginBottom: 4 }}>VÉLO</Label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <BikeChip label="Tous" active={bikeFilter === null} onClick={() => setBikeFilter(null)} />
                {bikesSeen.map(b => (
                  <BikeChip
                    key={b.id}
                    label={b.name}
                    active={bikeFilter === b.id}
                    onClick={() => setBikeFilter(bikeFilter === b.id ? null : b.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ padding: '32px 40px 24px', borderBottom: `1px solid ${tokens.creamBorder}`, background: tokens.surface }}>
      <SectionTag num={2} title="HEATMAP DES PARCOURS" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 36, fontWeight: 900, color: tokens.ink, margin: 0 }}>
        Mes <em style={{ color: tokens.green, fontStyle: 'italic' }}>territoires</em>
      </h1>
      <p style={{
        fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid,
        marginTop: 8, maxWidth: 640, lineHeight: 1.55,
      }}>
        Tes sorties empilées sur une seule carte. Plus une rue est foncée, plus tu l&apos;as
        parcourue. Filtre par sport, année ou vélo pour isoler une période ou un usage.
      </p>
    </div>
  );
}

function BikeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 9px',
        background: active ? tokens.terra : tokens.creamDark,
        border: 'none',
        borderRadius: 12,
        color: active ? '#fff' : tokens.inkMid,
        fontFamily: "'Space Grotesk'", fontSize: 10,
        fontWeight: active ? 700 : 500,
        letterSpacing: '0.04em',
        cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      {label}
    </button>
  );
}

const pickerStyle: CSSProperties = {
  position: 'absolute', top: 16, left: 16, zIndex: 1000,
  display: 'flex', gap: 4, padding: 4,
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 18, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  maxWidth: 'calc(100% - 32px)', overflowX: 'auto',
};

const legendStyle: CSSProperties = {
  position: 'absolute', top: 16, right: 16, zIndex: 1000,
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 4, padding: 14, minWidth: 200,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

const selectStyle: CSSProperties = {
  width: '100%', padding: '6px 8px',
  background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 3,
  fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.ink,
  cursor: 'pointer',
};
