'use client';

import { useState } from 'react';
import { tokens, Activity } from './tokens';
import { Label, useIsMobile } from './ui';
import { RouteModal, Proposal } from './RouteModal';
import { useT } from '@/i18n';

export function RouteProposals({ activities }: { activities: Activity[] }) {
  const [selected, setSelected] = useState<Proposal | null>(null);
  const isMobile = useIsMobile();
  const { t } = useT();

  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  if (last5.length < 2) return null;

  const avgDist = Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length);
  const avgElev = Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length);
  const tssValues = last5.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS    = tssValues.length ? Math.round(tssValues.reduce((s, v) => s + v, 0) / tssValues.length) : 80;

  // Tous les waypoints sont calés sur des intersections de routes départementales
  // (D6, D7, D16, D70, D75, D77, D389…) → OSRM colle aux axes principaux et ne
  // crée jamais de "doigts" / aller-retour sur petites voies. Ordre angulaire
  // monotone (CW ou CCW) autour de HOME pour de vraies boucles fermées.
  const d = avgDist, e = avgElev;
  const proposals: Proposal[] = [
    {
      tag: t('proposals.progression'), color: tokens.terra,
      title: t('proposals.classicLoop'),
      dist: Math.round(d * 1.1), elev: Math.round(e * 1.05), tss: Math.round(avgTSS * 1.1),
      tracks: [
        { name: 'Limonest → Civrieux → Lozanne', dist: 24, elev: 300, tss: Math.round(avgTSS*1.0),
          waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8514,4.6826]] },
        { name: 'Lentilly N → Lentilly C → Charbonnières', dist: 22, elev: 260, tss: Math.round(avgTSS*0.95),
          waypoints: [[45.8351,4.6965],[45.8170,4.7048],[45.7848,4.7591]] },
        { name: 'Saint-Didier → Saint-Cyr → Champagne', dist: 22, elev: 380, tss: Math.round(avgTSS*1.1),
          waypoints: [[45.8418,4.7894],[45.8553,4.7921],[45.7937,4.7770]] },
        { name: 'Lentilly → Marcy → Charbonnières', dist: 26, elev: 280, tss: Math.round(avgTSS*1.0),
          waypoints: [[45.8351,4.6965],[45.8170,4.7048],[45.7806,4.7280],[45.7848,4.7591]] },
        { name: 'Limonest → Saint-Didier → Saint-Cyr → Champagne', dist: 28, elev: 420, tss: Math.round(avgTSS*1.15),
          waypoints: [[45.8316,4.7706],[45.8418,4.7894],[45.8553,4.7921],[45.7937,4.7770]] },
      ],
      desc: t('proposals.classicDesc'),
      cues: [t('proposals.classicCue1'), t('proposals.classicCue2'), t('proposals.classicCue3')],
    },
    {
      tag: t('proposals.climb'), color: tokens.green,
      title: t('proposals.climbTitle'),
      dist: Math.round(d * 0.85), elev: Math.round(e * 1.4), tss: Math.round(avgTSS * 1.15),
      tracks: [
        { name: 'Mont Verdun (Limonest → Saint-Cyr → Saint-Didier)', dist: 22, elev: Math.round(e*1.3), tss: Math.round(avgTSS*1.1),
          waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8418,4.7894]] },
        { name: 'Limonest → Saint-Cyr → Champagne', dist: 24, elev: Math.round(e*1.4), tss: Math.round(avgTSS*1.15),
          waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.7937,4.7770]] },
        { name: 'Saint-Didier → Saint-Cyr → Saint-Romain', dist: 26, elev: Math.round(e*1.5), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.8418,4.7894],[45.8553,4.7921],[45.8385,4.8197]] },
        { name: 'Saint-Didier → Saint-Cyr → Saint-Romain → Curis', dist: 30, elev: Math.round(e*1.6), tss: Math.round(avgTSS*1.3),
          waypoints: [[45.8418,4.7894],[45.8553,4.7921],[45.8385,4.8197],[45.8915,4.8089]] },
        { name: "Triple col : Limonest → Poleymieux → Curis → Saint-Cyr → Saint-Didier", dist: 40, elev: Math.round(e*1.7), tss: Math.round(avgTSS*1.4),
          waypoints: [[45.8316,4.7706],[45.8918,4.7765],[45.8915,4.8089],[45.8385,4.8197],[45.8553,4.7921],[45.8418,4.7894]] },
      ],
      desc: t('proposals.climbDesc'),
      cues: [t('proposals.climbCue1', { elev: Math.round(e * 1.4) }), t('proposals.climbCue2'), t('proposals.climbCue3')],
    },
    {
      tag: t('proposals.recovery'), color: tokens.blue,
      title: t('proposals.recoveryTitle'),
      dist: Math.round(d * 0.62), elev: Math.round(e * 0.45), tss: Math.round(avgTSS * 0.5),
      tracks: [
        { name: 'Marcy / Charbonnières', dist: 13, elev: 100, tss: Math.round(avgTSS*0.35),
          waypoints: [[45.7848,4.7591],[45.7806,4.7280]] },
        { name: 'Lentilly aller', dist: 14, elev: 130, tss: Math.round(avgTSS*0.4),
          waypoints: [[45.8351,4.6965],[45.8170,4.7048]] },
        { name: 'Saint-Didier doux', dist: 15, elev: 180, tss: Math.round(avgTSS*0.45),
          waypoints: [[45.8316,4.7706],[45.8418,4.7894]] },
        { name: 'Lozanne plat', dist: 17, elev: 220, tss: Math.round(avgTSS*0.5),
          waypoints: [[45.8351,4.6965],[45.8514,4.6826]] },
        { name: 'Tour des trois villages', dist: 19, elev: 200, tss: Math.round(avgTSS*0.5),
          waypoints: [[45.7937,4.7770],[45.7848,4.7591],[45.7806,4.7280]] },
      ],
      desc: t('proposals.recoveryDesc', { tss: Math.round(avgTSS * 0.55) }),
      cues: [t('proposals.recoveryCue1'), t('proposals.recoveryCue2'), t('proposals.recoveryCue3')],
    },
    {
      tag: t('proposals.volume'), color: '#9b6fb5',
      title: t('proposals.volumeTitle'),
      dist: Math.round(d * 1.2), elev: e, tss: Math.round(avgTSS * 1.2),
      tracks: [
        { name: 'Limonest → Civrieux → Lozanne → Lentilly', dist: 30, elev: Math.round(e*1.0), tss: Math.round(avgTSS*1.15),
          waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8514,4.6826],[45.8170,4.7048]] },
        { name: 'Lentilly → Vaugneray → Charbonnières', dist: 32, elev: Math.round(e*1.15), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.8170,4.7048],[45.7501,4.7065],[45.7848,4.7591]] },
        { name: 'Limonest → Civrieux → Chessy → Lozanne', dist: 34, elev: Math.round(e*1.05), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8980,4.6828],[45.8514,4.6826]] },
        { name: 'Lentilly → L\'Arbresle → Charbonnières', dist: 36, elev: Math.round(e*1.0), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.8170,4.7048],[45.8369,4.6175],[45.7848,4.7591]] },
        { name: 'Limonest → Civrieux → Chazay → Chessy → Lozanne', dist: 38, elev: Math.round(e*1.1), tss: Math.round(avgTSS*1.25),
          waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8765,4.6990],[45.8980,4.6828],[45.8514,4.6826]] },
      ],
      desc: t('proposals.volumeDesc', { km: Math.round(d * 0.2) }),
      cues: [t('proposals.volumeCue1'), t('proposals.volumeCue2'), t('proposals.volumeCue3')],
    },
    {
      tag: t('proposals.volumeRelief'), color: '#c4602a',
      title: t('proposals.volumeRelTitle'),
      dist: Math.round(d * 1.2), elev: Math.round(e * 1.15), tss: Math.round(avgTSS * 1.35),
      tracks: [
        { name: 'Saint-Didier → Saint-Cyr → Champagne → Charbonnières', dist: 30, elev: Math.round(e*1.25), tss: Math.round(avgTSS*1.3),
          waypoints: [[45.8418,4.7894],[45.8553,4.7921],[45.7937,4.7770],[45.7848,4.7591]] },
        { name: 'Saint-Didier → Saint-Cyr → Vaugneray', dist: 32, elev: Math.round(e*1.3), tss: Math.round(avgTSS*1.35),
          waypoints: [[45.8418,4.7894],[45.8553,4.7921],[45.7937,4.7770],[45.7848,4.7591],[45.7501,4.7065]] },
        { name: 'Limonest → Saint-Cyr → Saint-Romain → Curis', dist: 34, elev: Math.round(e*1.4), tss: Math.round(avgTSS*1.4),
          waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8385,4.8197],[45.8915,4.8089]] },
        { name: 'Lozanne → Chessy → Lentilly → Vaugneray', dist: 36, elev: Math.round(e*1.2), tss: Math.round(avgTSS*1.35),
          waypoints: [[45.8514,4.6826],[45.8980,4.6828],[45.8170,4.7048],[45.7501,4.7065]] },
        { name: 'Lozanne → Chazay → Chessy → Lentilly → Vaugneray', dist: 38, elev: Math.round(e*1.3), tss: Math.round(avgTSS*1.4),
          waypoints: [[45.8514,4.6826],[45.8765,4.6990],[45.8980,4.6828],[45.8170,4.7048],[45.7501,4.7065]] },
      ],
      desc: t('proposals.volumeRelDesc', { km: Math.round(d * 0.2), elev: Math.round(e * 0.15) }),
      cues: [t('proposals.volumeRelCue1'), t('proposals.volumeRelCue2'), t('proposals.volumeRelCue3')],
    },
    {
      tag: t('proposals.big'), color: '#5a7a9e',
      title: t('proposals.bigTitle'),
      dist: 50, elev: Math.round(e * 1.3), tss: Math.round(avgTSS * 1.5),
      tracks: [
        { name: "~40km · Triple col Monts d'Or", dist: 40, elev: 600, tss: 110,
          waypoints: [[45.8316,4.7706],[45.8918,4.7765],[45.8915,4.8089],[45.8385,4.8197],[45.8553,4.7921],[45.8418,4.7894]] },
        { name: '~43km · Lozanne → Chessy → Lentilly → Vaugneray → Charbonnières', dist: 43, elev: 520, tss: 118,
          waypoints: [[45.8514,4.6826],[45.8980,4.6828],[45.8170,4.7048],[45.7501,4.7065],[45.7848,4.7591]] },
        { name: "~46km · Curis / Poleymieux complet", dist: 46, elev: 620, tss: 128,
          waypoints: [[45.8316,4.7706],[45.8918,4.7765],[45.8915,4.8089],[45.8385,4.8197],[45.8553,4.7921],[45.8418,4.7894],[45.7937,4.7770]] },
        { name: "~50km · Lozanne → L'Arbresle → Vaugneray → Charbonnières", dist: 50, elev: 580, tss: 140,
          waypoints: [[45.8514,4.6826],[45.8369,4.6175],[45.7501,4.7065],[45.7848,4.7591]] },
        { name: "~55km · Lozanne → L'Arbresle → Sain-Bel → Vaugneray", dist: 55, elev: 680, tss: 156,
          waypoints: [[45.8514,4.6826],[45.8369,4.6175],[45.8204,4.5703],[45.7501,4.7065],[45.7848,4.7591]] },
        { name: "~60km · Lozanne → L'Arbresle → Tarare → Vaugneray", dist: 60, elev: 760, tss: 175,
          waypoints: [[45.8514,4.6826],[45.8369,4.6175],[45.8989,4.4310],[45.7501,4.7065],[45.7848,4.7591]] },
      ],
      desc: t('proposals.bigDesc'),
      cues: [t('proposals.bigCue1'), t('proposals.bigCue2'), t('proposals.bigCue3')],
    },
  ];

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <>
      {selected && (
        <RouteModal proposal={selected} onClose={() => setSelected(null)} />
      )}
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.green }}>{t('proposals.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('proposals.label')}</Label>
      </div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginBottom: 20 }}>
        {t('proposals.basedOn', { dist: avgDist, elev: avgElev, tss: avgTSS })} <em>{t('proposals.clickHint')}</em>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 16 }}>
        {proposals.map((p, i) => (
          <div key={i}
            onClick={() => setSelected(p)}
            style={{ border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 16px rgba(0,0,0,0.1)`)}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
          >
            <div style={{ background: p.color, padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700, color: 'white', letterSpacing: '0.1em' }}>{p.tag}</span>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>{t('common.seeRoute')}</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink, marginBottom: 12 }}>{p.title}</div>
              <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: `1px solid ${tokens.creamBorder}`, paddingBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ display: 'block', marginBottom: 2 }}>{t('analysis.distance')}</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>{p.dist}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 2 }}>km</span></span>
                </div>
                <div style={{ flex: 1 }}>
                  <Label style={{ display: 'block', marginBottom: 2 }}>{t('common.elev')}</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>{p.elev}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 2 }}>m</span></span>
                </div>
                <div style={{ flex: 1 }}>
                  <Label style={{ display: 'block', marginBottom: 2 }}>{t('routeModal.tss')}</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: p.color }}>{p.tss}</span>
                </div>
              </div>
              <p style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.7, marginBottom: 12 }}>{p.desc}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {p.cues.map((c, j) => (
                  <li key={j} style={{ fontFamily: "'Space Grotesk'", fontSize: 10.5, color: tokens.inkLight, lineHeight: 1.8, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ color: p.color, marginTop: 1 }}>›</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
