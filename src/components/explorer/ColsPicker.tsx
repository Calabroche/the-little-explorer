'use client';

import { useEffect, useState, useMemo, useRef, CSSProperties } from 'react';
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

const RADII = [10, 15, 25, 50];

// "Cols à proximité": lists the mountain passes + named summits within a
// radius of the departure, nearest first, with elevation + distance + commune.
// Tapping one adds it to the route (the planner's stats bar then shows the
// total D+ / difficulty of the selected set).
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
  const [errored, setErrored] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const autoRetried = useRef(false);

  const cLat = center?.[0];
  const cLng = center?.[1];
  useEffect(() => {
    if (cLat == null || cLng == null) { setCols([]); setErrored(false); return; }
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    fetch('/api/cols', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: cLat, lng: cLng, radiusKm }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d: { cols?: Col[] }) => {
        if (cancelled) return;
        const list = d.cols ?? [];
        setCols(list);
        // The public Overpass mirrors flake intermittently → an empty result
        // is often a transient miss. Auto-retry ONCE before giving up.
        if (list.length === 0 && !autoRetried.current) {
          autoRetried.current = true;
          setReloadKey(k => k + 1);
        }
      })
      .catch(() => { if (!cancelled) { setCols([]); setErrored(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cLat, cLng, radiusKm, reloadKey]);

  // Reset the auto-retry guard when the query target changes.
  useEffect(() => { autoRetried.current = false; }, [cLat, cLng, radiusKm]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cols.filter(c => c.name.toLowerCase().includes(s)) : cols;
  }, [cols, q]);

  const selectedCount = cols.filter(c => selectedCodes.has(colCode(c))).length;
  const retry = () => { autoRetried.current = true; setReloadKey(k => k + 1); };

  // ── Header (always shown) ──────────────────────────────────────────────
  const header = (
    <div style={HEADER_ROW}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <Label>{en ? 'CLIMBS NEARBY' : 'COLS À PROXIMITÉ'}</Label>
        {selectedCount > 0 && (
          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700, color: tokens.terra }}>
            {selectedCount} {en ? 'selected' : 'sélectionné' + (selectedCount > 1 ? 's' : '')}
          </span>
        )}
      </div>
      {center != null && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {RADII.map(r => (
            <button key={r} onClick={() => setRadiusKm(r)} style={{
              padding: '4px 11px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
              background: radiusKm === r ? tokens.terra : tokens.creamDark,
              color: radiusKm === r ? '#fff' : tokens.inkMid,
            }}>{r} km</button>
          ))}
        </div>
      )}
    </div>
  );

  // ── No departure yet ───────────────────────────────────────────────────
  if (center == null) {
    return (
      <div style={CARD}>
        {header}
        <p style={HINT}>{en
          ? 'Add a start point (§ 01) to discover the cols you can ride to from there.'
          : 'Ajoute un point de départ (§ 01) pour découvrir les cols accessibles depuis là.'}</p>
      </div>
    );
  }

  return (
    <div style={CARD}>
      {header}

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={en ? 'Search a col…' : 'Chercher un col…'}
        style={{
          width: '100%', padding: '9px 12px', boxSizing: 'border-box', marginBottom: 12,
          fontFamily: "'Space Grotesk'", fontSize: 13,
          background: tokens.cream, color: tokens.ink,
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 6, outline: 'none',
        }}
      />

      {/* Loading */}
      {loading && cols.length === 0 && (
        <div style={GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ ...COL_CARD, opacity: 0.5, animation: 'pulse 1.2s ease-in-out infinite' }}>
              <span style={{ fontSize: 18 }}>⛰️</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', height: 11, width: '70%', background: tokens.creamDark, borderRadius: 3 }} />
                <span style={{ display: 'block', height: 8, width: '45%', background: tokens.creamDark, borderRadius: 3, marginTop: 6 }} />
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty / error → retry */}
      {!loading && filtered.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
          <p style={{ ...HINT, marginTop: 0 }}>
            {q.trim()
              ? (en ? 'No col matches your search.' : 'Aucun col ne correspond à ta recherche.')
              : errored
                ? (en ? 'The map server is busy right now.' : 'Le serveur cartographique est saturé là.')
                : (en ? `No col found within ${radiusKm} km.` : `Aucun col trouvé dans un rayon de ${radiusKm} km.`)}
          </p>
          {!q.trim() && (
            <button onClick={retry} style={RETRY_BTN}>
              ↻ {en ? 'Retry' : 'Réessayer'}
            </button>
          )}
        </div>
      )}

      {/* Results — wrapping card grid (uses the full section width) */}
      {filtered.length > 0 && (
        <div style={GRID}>
          {filtered.map(c => {
            const sel = selectedCodes.has(colCode(c));
            const sub = [c.city, c.ele != null ? `${c.ele} m` : null, `${c.distKm} km`].filter(Boolean).join(' · ');
            return (
              <button key={colCode(c)} onClick={() => onToggle(c)} style={{
                ...COL_CARD,
                border: `1px solid ${sel ? tokens.terra : tokens.creamBorder}`,
                background: sel ? tokens.terraLight : tokens.cream,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{c.kind === 'col' ? '⛰️' : '🗻'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 600, color: tokens.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <span style={{ display: 'block', fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 17, fontWeight: 700, color: sel ? tokens.terra : tokens.inkLight }}>{sel ? '✓' : '+'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CARD: CSSProperties = {
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 4, padding: 20,
};
const HEADER_ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, flexWrap: 'wrap', marginBottom: 14,
};
const GRID: CSSProperties = {
  display: 'grid', gap: 8,
  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
  maxHeight: 320, overflowY: 'auto',
};
const COL_CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
  borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box',
};
const RETRY_BTN: CSSProperties = {
  padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
  fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
  background: tokens.terra, color: '#fff', border: 'none',
};
const HINT: CSSProperties = {
  marginTop: 8, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.5,
};
