'use client';

import { useState, useEffect, useRef, useCallback, useMemo, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { useT } from '@/i18n';
import { UserId } from '../Sidebar';
import { Waypoint, Itinerary } from '../itinerary/types';
import { loadAll, upsert, remove, newId } from '../itinerary/storage';

// Leaflet pulls in `window` at import time → ssr:false.
const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then(m => m.TileLayer),    { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(m => m.Polyline),     { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false });
const Tooltip      = dynamic(() => import('react-leaflet').then(m => m.Tooltip),      { ssr: false });
const FitBounds    = dynamic(() => import('../itinerary/FitBounds').then(m => m.FitBounds), { ssr: false });

interface Props { user: UserId }

// ── Village search input ────────────────────────────────────────────────────

function VillageSearch({ onPick, placeholder }: {
  onPick: (w: Waypoint) => void;
  placeholder: string;
}) {
  const [q, setQ]                 = useState('');
  const [results, setResults]     = useState<Waypoint[]>([]);
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const debounceRef               = useRef<NodeJS.Timeout | null>(null);
  const containerRef              = useRef<HTMLDivElement | null>(null);

  // Debounced fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/commune-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) { setResults([]); return; }
        const data: Waypoint[] = await res.json();
        setResults(data);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 14px',
          fontFamily: "'Space Grotesk'", fontSize: 13,
          background: tokens.cream, color: tokens.ink,
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 4,
          outline: 'none',
        }}
      />
      {loading && (
        <span style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.1em',
        }}>…</span>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 4, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
        }}>
          {results.map(r => (
            <button
              key={r.code}
              onClick={() => { onPick(r); setQ(''); setResults([]); setOpen(false); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                width: '100%', padding: '8px 12px', textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink,
                borderBottom: `1px solid ${tokens.creamBorder}`,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = tokens.creamDark)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{r.name}</span>
              <span style={{ fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em' }}>{r.postal}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatKm(m: number): string { return (m / 1000).toFixed(1); }
function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

// ── Main component ──────────────────────────────────────────────────────────

export function ItineraryPage({ user }: Props) {
  const { t } = useT();
  const isMobile = useIsMobile();

  const [waypoints, setWaypoints]     = useState<Waypoint[]>([]);
  const [targetKm, setTargetKm]       = useState<number>(50);
  const [name, setName]               = useState<string>('');
  const [activeId, setActiveId]       = useState<string | null>(null); // current loaded itinerary

  const [geometry, setGeometry]       = useState<[number, number][] | null>(null);
  const [distanceM, setDistanceM]     = useState<number | null>(null);
  const [durationS, setDurationS]     = useState<number | null>(null);
  const [routing, setRouting]         = useState(false);
  const [routeError, setRouteError]   = useState<string | null>(null);

  const [library, setLibrary]         = useState<Itinerary[]>([]);

  // Hydrate library on mount + when user changes.
  useEffect(() => { setLibrary(loadAll(user)); }, [user]);

  // ── Waypoint manipulation ────────────────────────────────────────────────
  const addWaypoint  = (w: Waypoint) => setWaypoints(prev =>
    prev.some(p => p.code === w.code) ? prev : [...prev, w]
  );
  const removeWaypoint = (idx: number) => setWaypoints(prev => prev.filter((_, i) => i !== idx));
  const moveWaypoint   = (idx: number, dir: -1 | 1) => setWaypoints(prev => {
    const next = [...prev];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const clearAll = () => {
    setWaypoints([]); setGeometry(null); setDistanceM(null); setDurationS(null);
    setName(''); setActiveId(null); setRouteError(null);
  };

  // ── Routing ──────────────────────────────────────────────────────────────
  const computeRoute = useCallback(async () => {
    if (waypoints.length < 2) {
      setGeometry(null); setDistanceM(null); setDurationS(null); setRouteError(null);
      return;
    }
    setRouting(true); setRouteError(null);
    try {
      const res = await fetch('/api/route-bike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waypoints: waypoints.map(w => [w.lat, w.lng]) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setGeometry(data.geometry);
      setDistanceM(data.distance_m);
      setDurationS(data.duration_s);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRouteError(msg);
      setGeometry(null); setDistanceM(null); setDurationS(null);
    } finally {
      setRouting(false);
    }
  }, [waypoints]);

  // Auto-route whenever waypoints change (debounced).
  useEffect(() => {
    const id = setTimeout(computeRoute, 300);
    return () => clearTimeout(id);
  }, [computeRoute]);

  // ── Save / load / delete ─────────────────────────────────────────────────
  const handleSave = () => {
    if (waypoints.length < 2) return;
    const it: Itinerary = {
      id:          activeId ?? newId(),
      name:        name.trim() || `${waypoints[0].name} → ${waypoints[waypoints.length - 1].name}`,
      createdAt:   new Date().toISOString(),
      waypoints,
      targetKm,
      distanceKm:  distanceM != null ? +(distanceM / 1000).toFixed(1) : undefined,
      durationMin: durationS != null ? Math.round(durationS / 60)     : undefined,
      geometry:    geometry ?? undefined,
    };
    setLibrary(upsert(user, it));
    setActiveId(it.id);
    setName(it.name);
  };

  const handleLoad = (it: Itinerary) => {
    setActiveId(it.id);
    setName(it.name);
    setWaypoints(it.waypoints);
    setTargetKm(it.targetKm);
    setGeometry(it.geometry ?? null);
    setDistanceM(it.distanceKm != null ? it.distanceKm * 1000 : null);
    setDurationS(it.durationMin != null ? it.durationMin * 60 : null);
    setRouteError(null);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t('itinerary.confirmDelete'))) return;
    const next = remove(user, id);
    setLibrary(next);
    if (activeId === id) clearAll();
  };

  // ── Map data ─────────────────────────────────────────────────────────────
  const mapCenter = useMemo<[number, number]>(() => {
    if (waypoints.length > 0) return [waypoints[0].lat, waypoints[0].lng];
    return [45.75, 4.85]; // Lyon area default
  }, [waypoints]);

  const polylinePositions = geometry ?? null;

  const distanceKm = distanceM != null ? +(distanceM / 1000).toFixed(1) : null;
  const deltaKm    = distanceKm != null ? +(distanceKm - targetKm).toFixed(1) : null;
  const deltaPct   = distanceKm != null && targetKm > 0 ? ((distanceKm - targetKm) / targetKm) * 100 : 0;

  // ── Layout ───────────────────────────────────────────────────────────────
  const CARD: CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 20,
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={6} title={t('itinerary.tagTitle')} />
      <h1 style={{
        fontFamily: "'Playfair Display'",
        fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink,
        marginBottom: isMobile ? 20 : 32, lineHeight: 1.1,
      }}>
        {t('itinerary.headline')}<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic' }}>{t('itinerary.headlineEm')}</em>
      </h1>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: isMobile ? '1fr' : '380px 1fr' }}>
        {/* ─── LEFT COLUMN: builder ─────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Step 1: villages */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 10 }}>
              {t('itinerary.step1')}
            </Label>
            <VillageSearch
              onPick={addWaypoint}
              placeholder={t('itinerary.searchPlaceholder')}
            />
            {waypoints.length === 0 && (
              <p style={{ marginTop: 12, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.5 }}>
                {t('itinerary.searchHint')}
              </p>
            )}
            {waypoints.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {waypoints.map((w, i) => (
                  <div key={`${w.code}-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', background: tokens.creamDark, borderRadius: 3,
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: tokens.terra, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: "'Playfair Display'", fontSize: 12, fontWeight: 700,
                      flexShrink: 0,
                    }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink, fontWeight: 500 }}>
                        {w.name}
                      </div>
                      {w.postal && (
                        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em' }}>
                          {w.postal}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button title={t('itinerary.up')}     onClick={() => moveWaypoint(i, -1)} disabled={i === 0}                       style={iconBtnStyle(i === 0)}>↑</button>
                      <button title={t('itinerary.down')}   onClick={() => moveWaypoint(i, +1)} disabled={i === waypoints.length - 1}    style={iconBtnStyle(i === waypoints.length - 1)}>↓</button>
                      <button title={t('itinerary.remove')} onClick={() => removeWaypoint(i)}   style={iconBtnStyle(false, true)}>✕</button>
                    </div>
                  </div>
                ))}
                <button onClick={clearAll} style={{
                  marginTop: 4, alignSelf: 'flex-start',
                  fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                  background: 'none', border: 'none', color: tokens.inkLight, cursor: 'pointer',
                }}>
                  {t('itinerary.clearAll')}
                </button>
              </div>
            )}
          </div>

          {/* Step 2: target distance */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 10 }}>
              {t('itinerary.step2')}
            </Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" min={5} max={400} step={5}
                value={targetKm}
                onChange={e => setTargetKm(Math.max(0, Number(e.target.value) || 0))}
                style={{
                  width: 80, padding: '8px 10px',
                  fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink,
                  background: tokens.cream, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4,
                  outline: 'none',
                }}
              />
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight }}>km</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {[30, 50, 80, 120].map(km => (
                  <button key={km} onClick={() => setTargetKm(km)} style={{
                    padding: '4px 10px', fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 500,
                    background: targetKm === km ? tokens.terra : tokens.creamDark,
                    color: targetKm === km ? '#fff' : tokens.inkMid,
                    border: 'none', borderRadius: 12, cursor: 'pointer',
                  }}>{km}</button>
                ))}
              </div>
            </div>
            {distanceKm != null && (
              <div style={{ marginTop: 14, padding: 12, background: tokens.creamDark, borderRadius: 3 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 800, color: tokens.terra }}>
                    {distanceKm}
                  </span>
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>km {t('itinerary.computed')}</span>
                  {durationS != null && (
                    <span style={{ marginLeft: 'auto', fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
                      ≈ {formatDuration(durationS)}
                    </span>
                  )}
                </div>
                {deltaKm != null && (
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.5 }}>
                    {Math.abs(deltaPct) < 8 ? (
                      <span style={{ color: tokens.green, fontWeight: 600 }}>
                        ✓ {t('itinerary.onTarget')}
                      </span>
                    ) : deltaKm > 0 ? (
                      <>{t('itinerary.tooLong').replace('{n}', String(Math.abs(deltaKm)))}</>
                    ) : (
                      <>{t('itinerary.tooShort').replace('{n}', String(Math.abs(deltaKm)))}</>
                    )}
                  </div>
                )}
              </div>
            )}
            {routing && (
              <div style={{ marginTop: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {t('itinerary.computing')}
              </div>
            )}
            {routeError && (
              <div style={{ marginTop: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.terra, lineHeight: 1.5 }}>
                {t('itinerary.routeError')}: {routeError}
              </div>
            )}
          </div>

          {/* Step 3: save */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 10 }}>
              {t('itinerary.step3')}
            </Label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('itinerary.namePlaceholder')}
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 10,
                fontFamily: "'Space Grotesk'", fontSize: 13,
                background: tokens.cream, color: tokens.ink,
                border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, outline: 'none',
              }}
            />
            <button
              onClick={handleSave}
              disabled={waypoints.length < 2}
              style={{
                width: '100%', padding: '10px 12px',
                fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                background: waypoints.length < 2 ? tokens.creamBorder : tokens.terra,
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: waypoints.length < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              {activeId ? t('itinerary.update') : t('itinerary.save')}
            </button>
          </div>
        </div>

        {/* ─── RIGHT COLUMN: map ───────────────────────────────────────── */}
        <div style={{ ...CARD, padding: 0, overflow: 'hidden', minHeight: isMobile ? 360 : 520, position: 'relative' }}>
          <MapContainer center={mapCenter} zoom={waypoints.length > 0 ? 11 : 9} style={{ height: isMobile ? 360 : 520, width: '100%' }}>
            <TileLayer
              url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.cyclosm.org">CyclOSM</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {polylinePositions && polylinePositions.length > 1 && (
              <Polyline positions={polylinePositions} pathOptions={{ color: tokens.terra, weight: 4, opacity: 0.85 }} />
            )}
            {waypoints.map((w, i) => (
              <CircleMarker
                key={`${w.code}-${i}`}
                center={[w.lat, w.lng]}
                radius={9}
                pathOptions={{
                  fillColor: tokens.terra, color: '#fff', weight: 2, fillOpacity: 1,
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -10]}>
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600 }}>
                    {i + 1}. {w.name}
                  </span>
                </Tooltip>
              </CircleMarker>
            ))}
            <FitBounds positions={polylinePositions ?? waypoints.map(w => [w.lat, w.lng] as [number, number])} />
          </MapContainer>
        </div>
      </div>

      {/* ─── LIBRARY ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 32 }}>
        <Label style={{ display: 'block', marginBottom: 12 }}>
          {t('itinerary.library')} {library.length > 0 && <span style={{ color: tokens.terra }}>· {library.length}</span>}
        </Label>
        {library.length === 0 ? (
          <div style={{ ...CARD, fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, lineHeight: 1.6 }}>
            {t('itinerary.libraryEmpty')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {library.map(it => (
              <div key={it.id} style={{
                ...CARD, padding: 14,
                borderTop: activeId === it.id ? `2px solid ${tokens.terra}` : `1px solid ${tokens.creamBorder}`,
                cursor: 'pointer',
              }}
                onClick={() => handleLoad(it)}
              >
                <div style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: tokens.ink, marginBottom: 4 }}>
                  {it.name}
                </div>
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginBottom: 8, letterSpacing: '0.05em' }}>
                  {it.waypoints.length} {t('itinerary.stops')}
                  {it.distanceKm != null && ` · ${it.distanceKm} km`}
                  {it.durationMin != null && ` · ${formatDuration(it.durationMin * 60)}`}
                </div>
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.4, marginBottom: 8 }}>
                  {it.waypoints.slice(0, 4).map(w => w.name).join(' → ')}
                  {it.waypoints.length > 4 && ` → +${it.waypoints.length - 4}`}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, letterSpacing: '0.05em' }}>
                    {new Date(it.createdAt).toLocaleDateString()}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(it.id); }} style={{
                    fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                    background: 'none', border: 'none', color: tokens.inkLight, cursor: 'pointer',
                  }}>
                    {t('itinerary.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function iconBtnStyle(disabled: boolean, danger = false): CSSProperties {
  return {
    width: 24, height: 24,
    background: 'transparent', border: 'none', borderRadius: 3,
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? tokens.creamBorder : (danger ? tokens.terra : tokens.inkMid),
    fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.5 : 1,
  };
}
