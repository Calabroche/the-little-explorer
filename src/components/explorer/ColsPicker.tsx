'use client';

import { useEffect, useState, useMemo, CSSProperties } from 'react';
import { useT } from '@/i18n';
import { tokens } from './tokens';
import { Label } from './ui';

export interface Col {
  name: string;
  kind: 'col' | 'sommet';
  lat: number;
  lng: number;
  ele: number | null;
  distKm: number;
  city: string | null;
}

// Synthetic waypoint code for a selected col — lets the planner dedupe and
// toggle it like any other waypoint.
export function colCode(c: { lat: number; lng: number }): string {
  return `col:${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
}

const RADII = [10, 15, 25, 50, 100];

// "Cols à proximité": lists the mountain passes + named summits within a
// radius of the departure, nearest first, with elevation + distance. Tapping
// one adds it to the route (the planner's stats bar then shows the total D+ /
// difficulty of the selected set).
export function ColsPicker({ center, selectedCodes, onToggle }: {
  center: [number, number] | null;
  selectedCodes: Set<string>;
  onToggle: (col: Col) => void;
}) {
  const { lang } = useT();
  const en = lang === 'en';
  const [radiusKm, setRadiusKm] = useState(25);
  const [cols, setCols] = useState<Col[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const cLat = center?.[0];
  const cLng = center?.[1];
  useEffect(() => {
    if (cLat == null || cLng == null) { setCols([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch('/api/cols', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: cLat, lng: cLng, radiusKm }),
    })
      .then(r => (r.ok ? r.json() : { cols: [] }))
      .then((d: { cols?: Col[] }) => { if (!cancelled) setCols(d.cols ?? []); })
      .catch(() => { if (!cancelled) setCols([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cLat, cLng, radiusKm]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cols.filter(c => c.name.toLowerCase().includes(s)) : cols;
  }, [cols, q]);

  const selectedCount = cols.filter(c => selectedCodes.has(colCode(c))).length;

  if (center == null) {
    return (
      <div style={CARD}>
        <Label>{en ? 'CLIMBS NEARBY' : 'COLS À PROXIMITÉ'}</Label>
        <p style={HINT}>{en ? 'Add a start point above to see nearby cols.' : 'Ajoute un point de départ (§ 01) pour voir les cols à proximité.'}</p>
      </div>
    );
  }

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <Label>{en ? 'CLIMBS NEARBY' : 'COLS À PROXIMITÉ'}{selectedCount > 0 && <span style={{ color: tokens.terra }}> · {selectedCount}</span>}</Label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {RADII.map(r => (
            <button key={r} onClick={() => setRadiusKm(r)} style={{
              padding: '3px 8px', borderRadius: 12, border: 'none', cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
              background: radiusKm === r ? tokens.terra : tokens.creamDark,
              color: radiusKm === r ? '#fff' : tokens.inkMid,
            }}>{r}</button>
          ))}
        </div>
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={en ? 'Search a col…' : 'Chercher un col…'}
        style={{
          width: '100%', padding: '8px 10px', boxSizing: 'border-box',
          fontFamily: "'Space Grotesk'", fontSize: 12,
          background: tokens.cream, color: tokens.ink,
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, outline: 'none',
        }}
      />

      <div style={{ marginTop: 10, maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading && cols.length === 0 && <div style={HINT}>{en ? 'Searching cols…' : 'Recherche des cols…'}</div>}
        {!loading && filtered.length === 0 && <div style={HINT}>{en ? 'No col found in this radius.' : 'Aucun col trouvé dans ce rayon.'}</div>}
        {filtered.map(c => {
          const sel = selectedCodes.has(colCode(c));
          return (
            <button key={colCode(c)} onClick={() => onToggle(c)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6,
              border: `1px solid ${sel ? tokens.terra : tokens.creamBorder}`,
              background: sel ? tokens.terraLight : tokens.cream, cursor: 'pointer', textAlign: 'left',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{c.kind === 'col' ? '⛰️' : '🗻'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 600, color: tokens.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                <span style={{ display: 'block', fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.city ? `${c.city} · ` : ''}{c.ele != null ? `${c.ele} m · ` : ''}{c.distKm} km
                </span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 16, fontWeight: 700, color: sel ? tokens.terra : tokens.inkLight }}>{sel ? '✓' : '+'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const CARD: CSSProperties = {
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 4, padding: 20,
};
const HINT: CSSProperties = {
  marginTop: 8, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.5,
};
