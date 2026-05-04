'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { tokens } from './tokens';
import { Label, useIsMobile } from './ui';
import { useT } from '@/i18n';
import { downloadGpx } from '@/utils/gpx';

const RouteModalMap = dynamic(
  () => import('./RouteModalMap').then(m => m.RouteModalMap),
  { ssr: false }
);

// Départ/arrivée fixe : Chemin du Manoir, Dardilly 69570, France
const HOME: [number, number] = [45.8183, 4.7521];

// ── OSRM ─────────────────────────────────────────────────────────────────────

interface OSRMResult { positions: [number, number][]; distKm: number; }

async function fetchOSRMRoute(waypoints: [number, number][]): Promise<OSRMResult> {
  const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  // continue_straight=true : interdit les demi-tours aux waypoints intermédiaires
  // → empêche les aller-retour sur petites rues, force une vraie boucle.
  const url = `https://router.project-osrm.org/route/v1/cycling/${coords}`
    + `?overview=full&geometries=geojson&continue_straight=true`;
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
  onClose,
}: {
  proposal: Proposal;
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [route, setRoute]   = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);
  const [osrmDist, setOsrmDist] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const { t } = useT();

  const start: [number, number] = HOME;

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
        width: isMobile ? '100%' : '82vw',
        maxWidth: isMobile ? 'none' : 1060,
        height: isMobile ? '100%' : '82vh',
        background: tokens.surface,
        borderRadius: isMobile ? 0 : 6,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        border: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: `1px solid ${tokens.creamBorder}`,
          background: tokens.creamDark, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', flex: 1 }}>
            <div style={{ background: proposal.color, padding: '4px 10px', borderRadius: 2, flexShrink: 0 }}>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700, color: 'white', letterSpacing: '0.1em' }}>
                {isMobile ? proposal.tag.split(' ')[0] : proposal.tag}
              </span>
            </div>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 15 : 18, fontWeight: 700, color: tokens.ink, whiteSpace: 'nowrap' }}>
              {proposal.title}
            </span>
            {!isMobile && (
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
                — {proposal.tracks[selectedIdx].name}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button
              onClick={() => downloadGpx(route, `${proposal.title} — ${proposal.tracks[selectedIdx].name}`)}
              disabled={loading || route.length === 0}
              title={t('gpx.tooltip')}
              style={{
                background: proposal.color, border: 'none', cursor: loading || route.length === 0 ? 'not-allowed' : 'pointer',
                color: 'white', padding: '7px 12px', borderRadius: 3,
                fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                opacity: loading || route.length === 0 ? 0.4 : 1,
              }}
            >↓ {isMobile ? 'GPX' : t('gpx.download')}</button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 18, color: tokens.inkLight, lineHeight: 1,
            }}>✕</button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, overflow: isMobile ? 'auto' : 'hidden' }}>
          {/* Map */}
          <div style={{ flex: isMobile ? 'none' : 1, height: isMobile ? 280 : undefined, position: 'relative', flexShrink: 0 }}>
            {loading && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: tokens.creamDark,
                fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, letterSpacing: '0.1em',
              }}>
                {t('routeModal.computing')}
              </div>
            )}
            <RouteModalMap positions={route} color={proposal.color} center={start} />
          </div>

          {/* Right panel */}
          <div style={{
            width: isMobile ? '100%' : 256,
            flexShrink: 0,
            borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`,
            borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            {/* Track selector */}
            <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
              <Label style={{ display: 'block', marginBottom: 10 }}>{proposal.tracks.length} {t('routeModal.tracksProposed')}</Label>
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
              <Label style={{ display: 'block', marginBottom: 10 }}>{t('routeModal.thisRoute')}</Label>
              {(() => {
                const tk = proposal.tracks[selectedIdx];
                const dist = osrmDist ?? tk.dist;
                return [
                  { label: t('routeModal.distance'), value: dist,    unit: 'km', color: tokens.ink },
                  { label: t('routeModal.elev'),     value: tk.elev, unit: 'm',  color: tokens.ink },
                  { label: t('routeModal.tss'),      value: tk.tss,  unit: '',   color: proposal.color },
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
              <Label style={{ display: 'block', marginBottom: 8 }}>{t('routeModal.tips')}</Label>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {proposal.cues.map((c, i) => (
                  <li key={i} style={{ display: 'flex', gap: 6, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8 }}>
                    <span style={{ color: proposal.color }}>›</span>{c}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginTop: 'auto', padding: '10px 16px', borderTop: `1px solid ${tokens.creamBorder}`, fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, lineHeight: 1.7 }}>
              {t('routeModal.footer')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
