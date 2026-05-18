'use client';

import { useEffect, useMemo, useState, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens, Activity } from '../tokens';
import { SectionTag, Label } from '../ui';
import { useT } from '@/i18n';
import { SportId } from '../Sidebar';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer),    { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(mod => mod.Polyline),     { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Popup        = dynamic(() => import('react-leaflet').then(mod => mod.Popup),        { ssr: false });
// Local helper: pans/zooms the map whenever the centroid changes.
// Uses useMap() so it must be mounted inside MapContainer; lazy-loaded
// because react-leaflet pokes at `window` at import time.
const RecenterCamera = dynamic(() => import('../MapCamera').then(m => m.RecenterCamera), { ssr: false });

interface Props {
  activities: Activity[];
  // Kept for backward-compat with the existing call site; when set, the
  // single-activity inspector still works (e.g. tap a polyline → popup
  // → "view full detail"). All-routes view is the default behaviour
  // now to match iOS commit 3d0924a.
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

export function MapPage({ activities, selectedActivity }: Props) {
  const { t } = useT();

  // Only activities with GPS data are eligible for the map.
  const withGps = useMemo(() => activities.filter(a => a.gps && a.gps.length > 1), [activities]);

  // Sports actually present in the GPS data → drives the chip filter.
  const availableSports = useMemo(() => {
    const present = new Set(withGps.map(a => a.type as SportId));
    return SPORT_ORDER.filter(s => present.has(s));
  }, [withGps]);

  // Independent sport filter (not bound to the global sidebar toggle —
  // the user can be on cycling globally but inspect their hiking
  // routes on the map and back).
  const [sport, setSport] = useState<SportId>('cycling');
  useEffect(() => {
    if (availableSports.length === 0) return;
    if (!availableSports.includes(sport)) setSport(availableSports[0]);
  }, [availableSports, sport]);

  const filtered = useMemo(() => withGps.filter(a => a.type === sport), [withGps, sport]);

  // Centroid of the START point of each filtered ride — "where you
  // usually leave from" for that sport — with a span that scales with
  // how spread the departures are (with a sensible floor).
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

  // ── Single-activity mode (legacy backward-compat) ───────────────────
  if (selectedActivity) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header title={selectedActivity.title} />
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[selectedActivity.gps[0].lat, selectedActivity.gps[0].lng]} zoom={13} style={{ height: '100%', width: '100%' }} maxZoom={18}>
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
            />
            <Polyline
              positions={selectedActivity.gps.map(p => [p.lat, p.lng])}
              pathOptions={{ color: SPORT_COLOR[selectedActivity.type as SportId] ?? tokens.terra, weight: 4 }}
            />
          </MapContainer>
        </div>
      </div>
    );
  }

  // ── All-routes-by-sport (default) ───────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Header title={null} />
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer center={centroid.center} zoom={11} style={{ height: '100%', width: '100%' }} maxZoom={18}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
          />
          {filtered.map((a, i) => (
            <Polyline
              key={a.id ?? i}
              positions={a.gps.map(p => [p.lat, p.lng])}
              pathOptions={{ color: SPORT_COLOR[a.type as SportId] ?? tokens.terra, weight: 2.5, opacity: 0.55 }}
            />
          ))}
          {filtered.map((a, i) => a.gps[0] && (
            <CircleMarker key={`start-${a.id ?? i}`} center={[a.gps[0].lat, a.gps[0].lng]} radius={3}
              pathOptions={{ fillColor: SPORT_COLOR[a.type as SportId] ?? tokens.terra, color: '#fff', weight: 1, fillOpacity: 0.9 }}
            >
              <Popup>
                <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12 }}>{a.title}</span>
              </Popup>
            </CircleMarker>
          ))}
          <RecenterCamera center={centroid.center} spanDeg={centroid.spanDeg} />
        </MapContainer>

        {/* Sport picker — top-left, scrollable when many sports present */}
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

        {/* Legend — selected sport + ride count */}
        <div style={legendStyle}>
          <Label style={{ display: 'block', marginBottom: 6 }}>LÉGENDE</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 20, height: 2.5, background: SPORT_COLOR[sport], borderRadius: 2 }} />
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, flex: 1 }}>{t(`type.${sport}`)}</span>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700 }}>{filtered.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ title }: { title: string | null }) {
  return (
    <div style={{ padding: '32px 40px 24px', borderBottom: `1px solid ${tokens.creamBorder}`, background: tokens.surface }}>
      <SectionTag num={2} title="CARTE DES PARCOURS" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 36, fontWeight: 900, color: tokens.ink }}>
        {title ?? <>Mes <em style={{ color: tokens.green, fontStyle: 'italic' }}>territoires</em></>}
      </h1>
    </div>
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
  borderRadius: 4, padding: 14, minWidth: 180,
};
