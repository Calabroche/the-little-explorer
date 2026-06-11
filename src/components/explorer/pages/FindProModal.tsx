'use client';

/**
 * "Trouver un professionnel" — find bike shops / repairers near a point.
 *
 * The rider sets their bike brand (default Canyon, since not every shop
 * services direct-sales brands), picks a location (address search or current
 * position) and a radius (5/10/15 km), and gets every OSM bike shop in that
 * radius on a map + list. Brand is informational: OSM rarely records which
 * brands a shop repairs, so we flag a match when present and tell the user to
 * call ahead otherwise.
 */
import { useState, useRef, useEffect, useCallback, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens } from '../tokens';

const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then(m => m.TileLayer),    { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false });
const Tooltip      = dynamic(() => import('react-leaflet').then(m => m.Tooltip),      { ssr: false });
const FitBounds    = dynamic(() => import('../itinerary/FitBounds').then(m => m.FitBounds), { ssr: false });

interface Loc { lat: number; lng: number; label: string }
interface Shop {
  id: string; name: string; lat: number; lng: number; distKm: number;
  address: string | null; phone: string | null; website: string | null;
  hours: string | null; repairs: boolean; type: string; brandMatch: boolean; brandOnSite: boolean;
}
interface Suggestion { name: string; label?: string; postal?: string; lat: number; lng: number }

const RADII = [5, 10, 15];
const FONT = "'Space Grotesk'";

export function FindProModal({ onClose }: { onClose: () => void }) {
  const [brand, setBrand]   = useState('Canyon');
  const [radius, setRadius] = useState(10);
  const [loc, setLoc]       = useState<Loc | null>(null);

  const [q, setQ]           = useState('');
  const [sugs, setSugs]     = useState<Suggestion[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);

  const [shops, setShops]   = useState<Shop[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const SPECIAL = '#8A4FB5';   // brand-specialist colour (distinct from terra/green)
  const isSpecialist = (s: Shop) => s.brandMatch || s.brandOnSite;
  const focusShop = (id: string) => {
    setActiveId(id);
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ── Address typeahead (BAN via /api/commune-search) ──────────────────
  const debTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const s = q.trim();
    if (s.length < 3 || (loc && loc.label === s)) { setSugs([]); return; }
    clearTimeout(debTimer.current);
    debTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/commune-search?q=${encodeURIComponent(s)}`);
        const data = await r.json();
        setSugs(Array.isArray(data) ? data.slice(0, 6) : []);
      } catch { setSugs([]); }
    }, 250);
    return () => clearTimeout(debTimer.current);
  }, [q, loc]);

  const useMyPosition = () => {
    if (!navigator.geolocation) { setError('Géolocalisation indisponible.'); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Ma position' }); setQ('Ma position'); setSugs([]); setGeoBusy(false); },
      () => { setError('Position refusée. Tape une adresse à la place.'); setGeoBusy(false); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const search = useCallback(async () => {
    if (!loc) { setError('Choisis d’abord une localisation.'); return; }
    setLoading(true); setError(null); setShops(null); setActiveId(null);
    try {
      const r = await fetch(`/api/bike-shops?lat=${loc.lat}&lng=${loc.lng}&radiusKm=${radius}&brand=${encodeURIComponent(brand)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setShops(data.shops ?? []);
    } catch (e) { setError((e as Error).message); setShops([]); }
    finally { setLoading(false); }
  }, [loc, radius, brand]);

  const positions: [number, number][] | null = loc
    ? [[loc.lat, loc.lng], ...(shops ?? []).map(s => [s.lat, s.lng] as [number, number])]
    : null;

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={SHEET} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 800, color: tokens.ink, margin: 0 }}>
            Trouver un professionnel
          </h2>
          <button onClick={onClose} style={CLOSE}>✕</button>
        </div>
        <p style={{ fontFamily: FONT, fontSize: 12, color: tokens.inkMid, margin: '0 0 16px', lineHeight: 1.5 }}>
          Magasins et réparateurs vélo autour de toi. Indique ta marque : certains ateliers ne prennent pas toutes les marques (Canyon en vente directe, par exemple).
        </p>

        {/* Controls */}
        <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Ta marque de vélo">
              <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Canyon" style={INPUT} />
            </Field>
            <Field label="Rayon">
              <div style={{ display: 'flex', gap: 6 }}>
                {RADII.map(r => (
                  <button key={r} onClick={() => setRadius(r)} style={{
                    flex: 1, padding: '9px 0', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${radius === r ? tokens.terra : tokens.creamBorder}`,
                    background: radius === r ? tokens.terra : tokens.surface,
                    color: radius === r ? '#fff' : tokens.inkMid,
                    fontFamily: FONT, fontSize: 12, fontWeight: 700,
                  }}>{r} km</button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Localisation">
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={q}
                  onChange={e => { setQ(e.target.value); if (loc && e.target.value !== loc.label) setLoc(null); }}
                  placeholder="Adresse, ville ou village…"
                  style={{ ...INPUT, flex: 1 }}
                />
                <button onClick={useMyPosition} disabled={geoBusy} style={{
                  padding: '0 14px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                  border: `1px solid ${tokens.creamBorder}`, background: tokens.creamDark,
                  color: tokens.inkMid, fontFamily: FONT, fontSize: 12, fontWeight: 600,
                }}>📍 {geoBusy ? '…' : 'Ma position'}</button>
              </div>
              {sugs.length > 0 && (
                <div style={DROPDOWN}>
                  {sugs.map((s, i) => (
                    <button key={i} onClick={() => { setLoc({ lat: s.lat, lng: s.lng, label: s.label || s.name }); setQ(s.label || s.name); setSugs([]); }} style={SUG}>
                      <div style={{ fontWeight: 600, color: tokens.ink }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: tokens.inkLight }}>{s.label || s.postal}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <button onClick={search} disabled={loading || !loc} style={{
            padding: '12px', borderRadius: 4, border: 'none',
            background: !loc ? tokens.creamBorder : tokens.terra, color: '#fff',
            cursor: !loc ? 'not-allowed' : 'pointer',
            fontFamily: FONT, fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {loading ? 'Recherche…' : '🔧 Trouver les pros'}
          </button>
        </div>

        {error && <p style={{ fontFamily: FONT, fontSize: 12, color: '#A33', margin: '0 0 12px' }}>{error}</p>}

        {/* Two columns: map (left) + shop cards (right) */}
        {loc && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            {/* Map */}
            <div style={{ flex: '1 1 460px', minWidth: 300, height: 520, borderRadius: 6, overflow: 'hidden', border: `1px solid ${tokens.creamBorder}` }}>
              <MapContainer center={[loc.lat, loc.lng]} zoom={12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap &copy; CARTO" />
                <CircleMarker center={[loc.lat, loc.lng]} radius={7} pathOptions={{ fillColor: tokens.blue, color: '#fff', weight: 2, fillOpacity: 1 }}>
                  <Tooltip direction="top">{loc.label}</Tooltip>
                </CircleMarker>
                {(shops ?? []).map(s => {
                  const active = activeId === s.id;
                  const spec = isSpecialist(s);
                  return (
                    <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={active ? 10 : spec ? 8 : 6}
                      pathOptions={{ fillColor: spec ? SPECIAL : tokens.terra, color: active ? tokens.ink : '#fff', weight: active ? 2.5 : 1.5, fillOpacity: 1 }}
                      eventHandlers={{ click: () => focusShop(s.id) }}>
                      <Tooltip direction="top">{s.name} · {s.distKm} km{spec ? ` · ${brand}` : ''}</Tooltip>
                    </CircleMarker>
                  );
                })}
                <FitBounds positions={positions} />
              </MapContainer>
            </div>

            {/* Shop cards */}
            <div style={{ flex: '1 1 360px', minWidth: 300, maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loading && <p style={{ fontFamily: FONT, fontSize: 13, color: tokens.inkLight }}>Recherche des magasins + scan des sites…</p>}
              {shops != null && !loading && shops.length === 0 && (
                <p style={{ fontFamily: FONT, fontSize: 13, color: tokens.inkLight }}>Aucun magasin trouvé dans ce rayon. Élargis le rayon.</p>
              )}
              {shops != null && !loading && shops.length > 0 && (
                <>
                  <p style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 2px', position: 'sticky', top: 0, background: tokens.cream, padding: '2px 0' }}>
                    {shops.length} professionnel{shops.length > 1 ? 's' : ''}
                    {shops.some(isSpecialist) && <span style={{ color: SPECIAL }}> · {shops.filter(isSpecialist).length} {brand}</span>}
                  </p>
                  {shops.map(s => {
                    const active = activeId === s.id;
                    const spec = isSpecialist(s);
                    return (
                      <div key={s.id}
                        ref={el => { cardRefs.current[s.id] = el; }}
                        onMouseEnter={() => setActiveId(s.id)}
                        style={{
                          padding: 12, borderRadius: 6, background: active ? tokens.surface : tokens.surface,
                          border: `1px solid ${active ? tokens.terra : spec ? SPECIAL : tokens.creamBorder}`,
                          borderLeft: `4px solid ${spec ? SPECIAL : active ? tokens.terra : 'transparent'}`,
                          boxShadow: active ? '0 2px 10px rgba(0,0,0,0.12)' : 'none',
                          transition: 'border-color .15s, box-shadow .15s',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: tokens.ink }}>{s.name}</span>
                          <span style={{ fontFamily: FONT, fontSize: 12, color: tokens.inkMid, flexShrink: 0 }}>{s.distKm} km</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
                          {spec && <Badge color={SPECIAL}>⭐ Spécialiste {brand}</Badge>}
                          {s.repairs && <Badge color={tokens.green}>🔧 Réparation</Badge>}
                          {s.type === 'shop' && <Badge color={tokens.inkMid}>Magasin vélo</Badge>}
                        </div>
                        {s.address && <div style={{ fontFamily: FONT, fontSize: 12, color: tokens.inkMid }}>{s.address}</div>}
                        {s.hours && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.inkLight, marginTop: 2 }}>🕑 {s.hours}</div>}
                        <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                          {s.phone && <a href={`tel:${s.phone}`} style={LINK}>📞 {s.phone}</a>}
                          {s.website && <a href={s.website} target="_blank" rel="noopener noreferrer" style={LINK}>🌐 Site</a>}
                          <a href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`} target="_blank" rel="noopener noreferrer" style={LINK}>🗺️ Itinéraire</a>
                        </div>
                      </div>
                    );
                  })}
                  <p style={{ fontFamily: FONT, fontSize: 11, color: tokens.inkLight, lineHeight: 1.55, marginTop: 8 }}>
                    <span style={{ color: SPECIAL, fontWeight: 700 }}>⭐ Spécialiste {brand}</span> = leur site mentionne {brand}. Sinon la marque réparée n’est presque jamais publiée : <strong>appelle pour confirmer</strong>, surtout en vente directe.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.inkLight, display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 10, padding: '2px 8px' }}>{children}</span>;
}

const OVERLAY: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 2000, padding: '32px 16px', overflowY: 'auto' };
const SHEET: CSSProperties = { background: tokens.cream, borderRadius: 8, padding: 24, maxWidth: 1080, width: '100%', boxShadow: '0 16px 50px rgba(0,0,0,0.35)' };
const CLOSE: CSSProperties = { width: 30, height: 30, borderRadius: '50%', border: `1px solid ${tokens.creamBorder}`, background: tokens.surface, color: tokens.inkMid, cursor: 'pointer', fontFamily: FONT, fontSize: 14 };
const INPUT: CSSProperties = { width: '100%', padding: '10px 12px', boxSizing: 'border-box', fontFamily: FONT, fontSize: 13, background: tokens.surface, color: tokens.ink, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, outline: 'none' };
const DROPDOWN: CSSProperties = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', overflow: 'hidden' };
const SUG: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: `1px solid ${tokens.creamBorder}`, cursor: 'pointer', fontFamily: FONT, fontSize: 12 };
const LINK: CSSProperties = { fontFamily: FONT, fontSize: 12, fontWeight: 600, color: tokens.terra, textDecoration: 'none' };
