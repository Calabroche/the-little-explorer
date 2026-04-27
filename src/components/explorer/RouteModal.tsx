'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Activity, tokens } from './tokens';
import { Label } from './ui';

const RouteModalMap = dynamic(
  () => import('./RouteModalMap').then(m => m.RouteModalMap),
  { ssr: false }
);

// ── OSRM ─────────────────────────────────────────────────────────────────────

interface OSRMResult { positions: [number, number][]; distKm: number; }

async function fetchOSRMRoute(waypoints: [number, number][]): Promise<OSRMResult> {
  const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/cycling/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('OSRM error');
  const data = await res.json();
  if (!data.routes?.[0]) throw new Error('No route');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    positions: data.routes[0].geometry.coordinates.map(([lng, lat]: any) => [lat, lng] as [number, number]),
    distKm: Math.round(data.routes[0].distance / 100) / 10,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Track {
  name: string;
  waypoints: [number, number][];
  dist: number;  // km estimate
  elev: number;  // m D+ estimate
  tss: number;
}

export interface Proposal {
  tag: string;
  title: string;
  dist: number;
  elev: number;
  tss: number;
  color: string;
  tracks: Track[];
  desc: string;
  cues: string[];
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function RouteModal({
  proposal,
  activities,
  onClose,
}: {
  proposal: Proposal;
  activities: Activity[];
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [route, setRoute]   = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);
  const [osrmDist, setOsrmDist] = useState<number | null>(null);

  const start: [number, number] = (() => {
    const sorted = [...activities]
      .filter(a => (a.gps?.length ?? 0) > 0)
      .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
    if (sorted.length) { const p = sorted[0].gps[0]; return [p.lat, p.lng]; }
    return [45.824, 4.773];
  })();

  useEffect(() => {
    setLoading(true);
    setRoute([]);
    setOsrmDist(null);
    const track = proposal.tracks[selectedIdx];
    const pts: [number, number][] = [start, ...track.waypoints, start];
    fetchOSRMRoute(pts)
      .then(r => { setRoute(r.positions); setOsrmDist(r.distKm); setLoading(false); })
      .catch(() => { setRoute(pts); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '82vw', maxWidth: 1060, height: '82vh',
        background: tokens.surface, borderRadius: 6, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        border: `1px solid ${tokens.creamBorder}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: `1px solid ${tokens.creamBorder}`,
          background: tokens.creamDark, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: proposal.color, padding: '4px 10px', borderRadius: 2 }}>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700, color: 'white', letterSpacing: '0.1em' }}>
                {proposal.tag}
              </span>
            </div>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink }}>
              {proposal.title}
            </span>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
              — {proposal.tracks[selectedIdx].name}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 18, color: tokens.inkLight, lineHeight: 1,
          }}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Map */}
          <div style={{ flex: 1, position: 'relative' }}>
            {loading && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: tokens.creamDark,
                fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, letterSpacing: '0.1em',
              }}>
                CALCUL DU TRACÉ…
              </div>
            )}
            <RouteModalMap positions={route} color={proposal.color} center={start} />
          </div>

          {/* Right panel */}
          <div style={{
            width: 256, flexShrink: 0, borderLeft: `1px solid ${tokens.creamBorder}`,
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            {/* Track selector */}
            <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
              <Label style={{ display: 'block', marginBottom: 10 }}>{proposal.tracks.length} TRACÉS PROPOSÉS</Label>
              {proposal.tracks.map((t, i) => (
                <button key={i} onClick={() => setSelectedIdx(i)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 12px', marginBottom: 6, borderRadius: 3, cursor: 'pointer',
                  border: `1px solid ${i === selectedIdx ? proposal.color : tokens.creamBorder}`,
                  background: i === selectedIdx ? proposal.color + '18' : tokens.creamDark,
                  textAlign: 'left', transition: 'all 0.12s',
                }}>
                  <span style={{
                    fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700,
                    color: i === selectedIdx ? proposal.color : tokens.inkLight,
                    minWidth: 18,
                  }}>{i + 1}</span>
                  <span style={{
                    fontFamily: "'Space Grotesk'", fontSize: 11,
                    color: i === selectedIdx ? tokens.ink : tokens.inkMid,
                    fontWeight: i === selectedIdx ? 600 : 400,
                  }}>{t.name}</span>
                </button>
              ))}
            </div>

            {/* Stats */}
            <div style={{ padding: '16px', borderTop: `1px solid ${tokens.creamBorder}`, marginTop: 10 }}>
              <Label style={{ display: 'block', marginBottom: 10 }}>CE TRACÉ</Label>
              {(() => {
                const t = proposal.tracks[selectedIdx];
                const dist = osrmDist ?? t.dist;
                return [
                  { label: 'Distance', value: dist,   unit: 'km', color: tokens.ink },
                  { label: 'D+',       value: t.elev,  unit: 'm',  color: tokens.ink },
                  { label: 'TSS',      value: t.tss,   unit: '',   color: proposal.color },
                ].map(({ label, value, unit, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${tokens.creamBorder}` }}>
                    <Label>{label}</Label>
                    <span style={{ fontFamily: "'Playfair Display'", fontSize: 17, fontWeight: 700, color }}>
                      {value}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 2 }}>{unit}</span>
                    </span>
                  </div>
                ));
              })()}
            </div>

            {/* Cues */}
            <div style={{ padding: '0 16px 16px' }}>
              <Label style={{ display: 'block', marginBottom: 8 }}>CONSEILS</Label>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {proposal.cues.map((c, i) => (
                  <li key={i} style={{ display: 'flex', gap: 6, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8 }}>
                    <span style={{ color: proposal.color }}>›</span>{c}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginTop: 'auto', padding: '10px 16px', borderTop: `1px solid ${tokens.creamBorder}`, fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, lineHeight: 1.7 }}>
              Tracé OSRM · Zone Dardilly / Monts d'Or
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
