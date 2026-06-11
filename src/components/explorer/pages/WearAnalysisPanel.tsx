'use client';

/**
 * "Analyse d'usure" tab of the Matériel page.
 *
 * Picks a bike, calls /api/equipment/wear-analysis and renders:
 *   1. the narrative verdict ("tes plaquettes s'usent 2.3× plus vite…")
 *   2. terrain summary chips (D+/km, descente raide, freinages…)
 *   3. per-component wear multipliers + adjusted replacement intervals
 *   4. the installed pieces re-scored with terrain-adjusted wear
 *   5. a per-ride table: pente min / max / moyenne, D+, D−, freinages
 */

import { useEffect, useState } from 'react';
import { tokens } from '../tokens';

interface Bike { id: string; name: string; primary_bike: boolean; totalKm: number }

interface RideRow {
  id: number; title: string; date: string; km: number; durationMin: number;
  ascentM: number; descentM: number;
  minGradePct: number | null; maxGradePct: number | null; avgGradePct: number | null;
  avgClimbPct: number | null; avgDescPct: number | null;
  climbKm: number; descKm: number; steepDescKm: number;
  brakeEvents: number; brakeKJ: number; hasStreams: boolean;
  mult: Record<string, number>;
}

interface BreakdownTerm { label: string; detail: string; contrib: number }
interface Breakdown { terms: BreakdownTerm[]; total: number; capped: boolean; why: string }

interface Component {
  key: string; label: string; multiplier: number;
  breakdown: Breakdown;
  example: string | null;
}

interface Analysis {
  gear: { id: string; name: string };
  terrain: { rideCount: number; totalKm: number; ascentPerKm: number; descentPerKm: number; steepDescKm: number; brakeEvents: number; brakeKJ: number };
  components: Component[];
  pieces: { id: string; name: string; component: string; lifetimeKm: number; rawKmSinceInstall: number; effectiveKmSinceInstall: number; adjustedWearPct: number | null; rawWearPct: number | null; adjustedIntervalKm: number | null }[];
  rides: RideRow[];
  narrative: string;
}

const FONT = "'Space Grotesk'";

export function WearAnalysisPanel({ bikes }: { bikes: Bike[] }) {
  const [gearId, setGearId] = useState<string>(bikes.find(b => b.primary_bike)?.id ?? bikes[0]?.id ?? '');
  const [data, setData]     = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [showAllRides, setShowAllRides] = useState(false);
  const [openComp, setOpenComp] = useState<string | null>('brake_pads');

  useEffect(() => {
    if (!gearId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/equipment/wear-analysis?gearId=${encodeURIComponent(gearId)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Analysis) => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) { setData(null); setError(String(e.message ?? e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gearId]);

  if (bikes.length === 0) {
    return <p style={{ fontFamily: FONT, fontSize: 13, color: tokens.inkLight }}>
      Connecte Strava avec au moins un vélo pour analyser son usure.
    </p>;
  }

  return (
    <div>
      {/* Bike picker */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {bikes.map(b => (
          <button key={b.id} onClick={() => setGearId(b.id)} style={{
            padding: '7px 14px', borderRadius: 18, cursor: 'pointer',
            border: `1px solid ${gearId === b.id ? tokens.terra : tokens.creamBorder}`,
            background: gearId === b.id ? tokens.terra : tokens.surface,
            color: gearId === b.id ? '#fff' : tokens.inkMid,
            fontFamily: FONT, fontSize: 12, fontWeight: 600,
          }}>
            {b.name} · {b.totalKm.toFixed(0)} km
          </button>
        ))}
      </div>

      {loading && <p style={{ fontFamily: FONT, fontSize: 13, color: tokens.inkLight }}>Analyse des sorties (pente, descentes, freinages)…</p>}
      {error && <p style={{ fontFamily: FONT, fontSize: 13, color: '#A00' }}>Erreur : {error}</p>}

      {data && !loading && (
        <>
          {/* 1. Narrative */}
          <div style={{
            padding: 18, marginBottom: 16, background: tokens.surface,
            border: `1px solid ${tokens.creamBorder}`, borderLeft: `4px solid ${tokens.terra}`, borderRadius: 4,
          }}>
            <p style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 8px' }}>
              § VERDICT
            </p>
            <p style={{ fontFamily: FONT, fontSize: 14, color: tokens.ink, lineHeight: 1.65, margin: 0 }}>
              {data.narrative}
            </p>
          </div>

          {/* 2. Terrain chips */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20, padding: 16, background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4 }}>
            {[
              { label: 'Sorties analysées', value: `${data.terrain.rideCount}` },
              { label: 'Distance totale',   value: `${data.terrain.totalKm} km` },
              { label: 'D+ moyen par km',   value: `${data.terrain.ascentPerKm} m`, color: tokens.terra },
              { label: 'Descente raide (≤ −5 %)', value: `${data.terrain.steepDescKm} km`, color: tokens.blue },
              { label: 'Freinages appuyés', value: `${data.terrain.brakeEvents}` },
              { label: 'Énergie de freinage', value: `${(data.terrain.brakeKJ / 1000).toFixed(1)} MJ` },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontFamily: "'Playfair Display'", fontSize: 21, fontWeight: 800, color: s.color ?? tokens.ink, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* 3. Component multipliers — click a row to expand the maths */}
          <p style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 4px' }}>
            § USURE PAR COMPOSANT (vs terrain plat)
          </p>
          <p style={{ fontFamily: FONT, fontSize: 11, color: tokens.inkLight, margin: '0 0 10px' }}>
            Touche un composant pour voir le détail du calcul.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {data.components.map(c => {
              const piece = data.pieces.find(p => p.component === c.key);
              const hot = c.multiplier >= 1.8, warm = c.multiplier >= 1.25;
              const open = openComp === c.key;
              const mColor = hot ? '#A33' : warm ? tokens.terra : tokens.green;
              return (
                <div key={c.key} style={{ background: tokens.surface, border: `1px solid ${open ? tokens.terra : (hot ? '#D88' : tokens.creamBorder)}`, borderRadius: 4, overflow: 'hidden' }}>
                  <button
                    onClick={() => setOpenComp(open ? null : c.key)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 14, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                      <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.inkLight }}>{open ? '▾' : '▸'}</span>
                      <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: tokens.ink }}>{c.label}</span>
                      {piece?.adjustedWearPct != null && (
                        <span style={{ fontFamily: FONT, fontSize: 11, color: piece.adjustedWearPct >= 90 ? '#A33' : tokens.inkLight }}>
                          {piece.adjustedWearPct}% usure
                        </span>
                      )}
                    </span>
                    <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 800, color: mColor, flexShrink: 0 }}>
                      ×{c.multiplier.toFixed(2)}
                    </span>
                  </button>

                  {open && (
                    <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${tokens.creamBorder}` }}>
                      <p style={{ fontFamily: FONT, fontSize: 12, color: tokens.inkMid, lineHeight: 1.6, margin: '12px 0 14px' }}>
                        {c.breakdown.why}
                      </p>

                      {/* Term-by-term maths */}
                      <div style={{ background: tokens.creamDark, borderRadius: 4, padding: '4px 12px' }}>
                        {c.breakdown.terms.map((t, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: i < c.breakdown.terms.length - 1 ? `1px solid ${tokens.creamBorder}` : 'none' }}>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ fontFamily: FONT, fontSize: 13, color: tokens.ink, fontWeight: 600 }}>{t.label}</span>
                              <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.inkLight, display: 'block' }}>{t.detail}</span>
                            </span>
                            <span style={{ fontFamily: 'monospace', fontSize: 14, color: i === 0 ? tokens.inkMid : tokens.terra, fontWeight: 700, flexShrink: 0 }}>
                              {i === 0 ? t.contrib.toFixed(2) : `+${t.contrib.toFixed(2)}`}
                            </span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderTop: `2px solid ${tokens.creamBorder}`, marginTop: 2 }}>
                          <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: tokens.ink }}>
                            Multiplicateur{c.breakdown.capped ? ' (plafonné)' : ''}
                          </span>
                          <span style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 800, color: mColor }}>×{c.breakdown.total.toFixed(2)}</span>
                        </div>
                      </div>

                      {c.example && (
                        <p style={{ fontFamily: FONT, fontSize: 12, color: tokens.inkMid, lineHeight: 1.6, margin: '14px 0 0', padding: 12, background: tokens.cream, borderRadius: 4, borderLeft: `3px solid ${tokens.terra}` }}>
                          <strong style={{ color: tokens.ink }}>Concret : </strong>{c.example}
                        </p>
                      )}

                      {piece && (
                        <p style={{ fontFamily: FONT, fontSize: 12, color: tokens.inkMid, lineHeight: 1.6, margin: '12px 0 0' }}>
                          {piece.name} : <strong style={{ color: tokens.ink }}>{piece.rawKmSinceInstall} km</strong> roulés ={' '}
                          <strong style={{ color: tokens.ink }}>{piece.effectiveKmSinceInstall} km</strong> équivalents →{' '}
                          <strong style={{ color: (piece.adjustedWearPct ?? 0) >= 90 ? '#A33' : tokens.ink }}>{piece.adjustedWearPct}% d&apos;usure</strong>
                          {piece.adjustedIntervalKm != null && <> · à remplacer vers <strong style={{ color: tokens.ink }}>{piece.adjustedIntervalKm} km</strong> (au lieu de {piece.lifetimeKm})</>}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 4. Per-ride table */}
          <p style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 10px' }}>
            § DÉTAIL PAR SORTIE
          </p>
          <div style={{ overflowX: 'auto', background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 12 }}>
              <thead>
                <tr>
                  {['Sortie', 'Km', 'D+', 'D−', 'Montée max', 'Descente max', 'Pente moy', 'Desc. raide', 'Freinages', 'Plaquettes'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${tokens.creamBorder}`, color: tokens.inkLight, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(showAllRides ? data.rides : data.rides.slice(0, 10)).map(r => (
                  <tr key={r.id}>
                    <td style={{ padding: '9px 12px', borderBottom: `1px solid ${tokens.creamBorder}`, color: tokens.ink, maxWidth: 220 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                      <div style={{ color: tokens.inkLight, fontSize: 10 }}>{new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    </td>
                    <td style={cell()}>{r.km.toFixed(1)}</td>
                    <td style={cell(tokens.terra)}>{r.ascentM} m</td>
                    <td style={cell(tokens.blue)}>{r.descentM} m</td>
                    <td style={cell(tokens.terra)}>{r.maxGradePct != null ? `+${r.maxGradePct} %` : '—'}</td>
                    <td style={cell(tokens.blue)}>{r.minGradePct != null ? `${r.minGradePct} %` : '—'}</td>
                    <td style={cell()}>{r.avgGradePct != null ? `${r.avgGradePct} %` : '—'}</td>
                    <td style={cell()}>{r.steepDescKm > 0 ? `${r.steepDescKm} km` : '—'}</td>
                    <td style={cell()}>{r.hasStreams ? r.brakeEvents : '—'}</td>
                    <td style={cell(r.mult.brake_pads >= 1.8 ? '#A33' : tokens.ink)}>×{r.mult.brake_pads.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rides.length > 10 && (
            <button onClick={() => setShowAllRides(v => !v)} style={{
              marginTop: 10, padding: '7px 14px', background: 'transparent',
              border: `1px solid ${tokens.creamBorder}`, borderRadius: 3, cursor: 'pointer',
              fontFamily: FONT, fontSize: 11, fontWeight: 600, color: tokens.inkMid,
            }}>
              {showAllRides ? 'Réduire' : `Voir les ${data.rides.length} sorties`}
            </button>
          )}

          <p style={{ fontFamily: FONT, fontSize: 11, color: tokens.inkLight, lineHeight: 1.6, marginTop: 16, maxWidth: 720 }}>
            Méthode : pente lissée sur des fenêtres de 40 m depuis le GPS, freinages détectés par décélérations
            soutenues dans le flux de vitesse, et énergie dissipée estimée en chaleur dans les freins. Les
            multiplicateurs comparent ton terrain à une sortie plate de référence. C&apos;est une estimation pour
            anticiper, pas un capteur d&apos;usure : vérifie visuellement avant de remplacer.
          </p>
        </>
      )}
    </div>
  );
}

function cell(color: string = tokens.ink): React.CSSProperties {
  return { padding: '9px 12px', borderBottom: `1px solid ${tokens.creamBorder}`, color, whiteSpace: 'nowrap' };
}
