'use client';

import { useState } from 'react';
import { tokens, Activity, GlobalStats } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { ActivityCard } from '../ActivityCard';
import { RouteModal, Proposal } from '../RouteModal';

// ── Training Program ──────────────────────────────────────────────────────────

function daysBetween(a: string, b: string) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function formatPredictedDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function TrainingProgram({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  if (last5.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 0; i < last5.length - 1; i++)
    gaps.push(daysBetween(last5[i].rawDate, last5[i + 1].rawDate));
  const avgGap = Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length);

  const nextDate = new Date(last5[0].rawDate);
  nextDate.setDate(nextDate.getDate() + avgGap);
  const daysUntil = daysBetween(nextDate.toISOString(), new Date().toISOString());

  const tssValues = last5.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS    = tssValues.length ? Math.round(tssValues.reduce((s, v) => s + v, 0) / tssValues.length) : null;
  const lastTSS   = tssValues[0] ?? null;
  const targetTSS = avgTSS ? Math.round(avgTSS * 1.1) : null;
  const tssMax    = tssValues.length ? Math.max(...tssValues) : 1;

  let advice = 'Maintiens ta régularité et augmente progressivement le volume.';
  if (lastTSS && avgTSS) {
    if (lastTSS > avgTSS * 1.3)
      advice = 'Sortie intense récente — prévois une séance légère ou récupération active.';
    else if (lastTSS < avgTSS * 0.7)
      advice = 'Sortie légère récente — tu peux remettre le paquet sur la prochaine.';
    else if (avgTSS > 80)
      advice = 'Charge élevée maintenue. Surveille ta récupération, intègre une semaine allégée.';
  }

  const avgDist = Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length);
  const avgElev = Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.terra }}>§ PROGRAMME</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>ANALYSE & PROCHAINE SORTIE</Label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: isMobile ? 20 : 24 }}>

        {/* TSS + Power trend bars */}
        <div>
          <Label style={{ display: 'block', marginBottom: 12 }}>5 DERNIÈRES SORTIES — TSS</Label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
            {last5.slice().reverse().map((a, i) => {
              const tss = a.tss ?? 0;
              const h   = tssMax ? Math.max(4, (tss / tssMax) * 100) : 4;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', height: `${h}%`, background: tokens.terra, borderRadius: 2, opacity: 0.55 + i * 0.09 }} />
                  <Label style={{ fontSize: 8 }}>{tss || '—'}</Label>
                </div>
              );
            })}
          </div>
          {/* Avg power per ride */}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {last5.slice().reverse().map((a, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                {a.avg_power != null
                  ? <Label style={{ fontSize: 8, color: tokens.green }}>{a.avg_power}W</Label>
                  : <Label style={{ fontSize: 8 }}>—</Label>}
              </div>
            ))}
          </div>
          <Label style={{ fontSize: 9, color: tokens.green, marginTop: 2, display: 'block' }}>puissance moy. par sortie</Label>
          <div style={{ marginTop: 10, display: 'flex', gap: 20 }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>INTERVALLE MOY.</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgGap}j
              </span>
            </div>
            {avgTSS && (
              <div>
                <Label style={{ display: 'block', marginBottom: 3 }}>TSS MOY.</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                  {avgTSS}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Next ride prediction */}
        <div style={{ borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`, paddingLeft: isMobile ? 0 : 24, borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none', paddingTop: isMobile ? 20 : 0 }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>PROCHAINE SORTIE PRÉVUE</Label>
          <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.terra, lineHeight: 1.3, marginBottom: 6 }}>
            {formatPredictedDate(nextDate.toISOString())}
          </div>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, marginBottom: 16 }}>
            {daysUntil > 0
              ? `Dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''}`
              : daysUntil === 0 ? "Aujourd'hui !"
              : `Dépassé de ${Math.abs(daysUntil)}j`}
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>DISTANCE</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgDist}<span style={{ fontSize: 11, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 3 }}>km</span>
              </span>
            </div>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>D+</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgElev}<span style={{ fontSize: 11, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 3 }}>m</span>
              </span>
            </div>
            {targetTSS && (
              <div>
                <Label style={{ display: 'block', marginBottom: 3 }}>TSS CIBLE</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.terra }}>
                  {targetTSS}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Advice + TSS explainer */}
        <div style={{ borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`, paddingLeft: isMobile ? 0 : 24, borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none', paddingTop: isMobile ? 20 : 0 }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>RECOMMANDATION</Label>
          <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.7, marginBottom: 14 }}>
            {advice}
          </p>
          <div style={{ padding: '10px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8, marginBottom: 12 }}>
            <strong style={{ color: tokens.ink }}>Règle des 10%</strong><br />
            N&apos;augmente pas le TSS hebdomadaire de plus de 10% par semaine.
          </div>
          <div style={{ padding: '10px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8 }}>
            <strong style={{ color: tokens.terra }}>Qu&apos;est-ce que le TSS ?</strong><br />
            <strong>T</strong>raining <strong>S</strong>tress <strong>S</strong>core mesure la charge d&apos;une sortie.<br />
            Formule : <code style={{ color: tokens.ink }}>(durée_s × NP × IF) / (FTP × 3600) × 100</code><br />
            <strong style={{ color: tokens.ink }}>FTP = 291W</strong> (66 kg × 2.205 × 2 — seuil fonctionnel estimé)<br />
            <span style={{ color: tokens.green }}>{'< 50'}</span> récupération · <span style={{ color: tokens.terra }}>50–75</span> modéré · <span style={{ color: '#e07030' }}>75–100</span> difficile · <span style={{ color: '#cc3333' }}>{'>100'}</span> très exigeant
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Route Proposals ───────────────────────────────────────────────────────────

function RouteProposals({ activities }: { activities: Activity[] }) {
  const [selected, setSelected] = useState<Proposal | null>(null);
  const isMobile = useIsMobile();

  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  if (last5.length < 2) return null;

  const avgDist = Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length);
  const avgElev = Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length);
  const tssValues = last5.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS    = tssValues.length ? Math.round(tssValues.reduce((s, v) => s + v, 0) / tssValues.length) : 80;

  // Each track: 2-3 waypoints forming a clean triangle → OSRM routes without dead-ends.
  // Distances calibrated for avgDist=25km base.
  const d = avgDist, e = avgElev;
  const proposals: Proposal[] = [
    {
      tag: 'PROGRESSION +10%', color: tokens.terra,
      title: 'Classique boucle',
      dist: Math.round(d * 1.1), elev: Math.round(e * 1.05), tss: Math.round(avgTSS * 1.1),
      tracks: [
        { name: 'Limonest → Lozanne',           dist: 27, elev: 340, tss: Math.round(avgTSS*1.05),
          waypoints: [[45.857,4.758],[45.851,4.691]] },
        { name: 'Chessy → Lentilly',             dist: 28, elev: 360, tss: Math.round(avgTSS*1.1),
          waypoints: [[45.898,4.688],[45.820,4.727]] },
        { name: 'Charbonnières → Vaugneray',     dist: 27, elev: 310, tss: Math.round(avgTSS*0.98),
          waypoints: [[45.799,4.756],[45.749,4.707]] },
        { name: 'Limonest → Saint-Cyr',          dist: 26, elev: 400, tss: Math.round(avgTSS*1.1),
          waypoints: [[45.857,4.758],[45.858,4.793]] },
        { name: 'Lentilly → Saint-Romain',       dist: 28, elev: 350, tss: Math.round(avgTSS*1.1),
          waypoints: [[45.820,4.727],[45.839,4.652]] },
      ],
      desc: `Boucles propres ~25-28 km autour de Dardilly. IF cible 0.75–0.80.`,
      cues: ['Montée progressive dès le départ', 'Maintenir cadence en crête', 'Retour en Z2'],
    },
    {
      tag: 'TRAVAIL D+', color: tokens.green,
      title: 'Cols des Monts d\'Or',
      dist: Math.round(d * 0.85), elev: Math.round(e * 1.4), tss: Math.round(avgTSS * 1.15),
      tracks: [
        { name: 'Saint-Cyr → Poleymieux',              dist: 20, elev: Math.round(e*1.4), tss: Math.round(avgTSS*1.1),
          waypoints: [[45.858,4.793],[45.892,4.776]] },
        { name: 'Limonest → Poleymieux → Saint-Cyr',   dist: 22, elev: Math.round(e*1.5), tss: Math.round(avgTSS*1.15),
          waypoints: [[45.857,4.758],[45.892,4.776],[45.858,4.793]] },
        { name: 'Saint-Didier → Curis',                dist: 20, elev: Math.round(e*1.35), tss: Math.round(avgTSS*1.1),
          waypoints: [[45.843,4.814],[45.903,4.830]] },
        { name: 'Saint-Cyr → Curis',                   dist: 22, elev: Math.round(e*1.5), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.858,4.793],[45.903,4.830]] },
        { name: 'Limonest → Saint-Cyr → Saint-Didier', dist: 22, elev: Math.round(e*1.6), tss: Math.round(avgTSS*1.25),
          waypoints: [[45.857,4.758],[45.858,4.793],[45.843,4.814]] },
      ],
      desc: `D+ ×1.4 via les crêtes des Monts d'Or. Montées à 60–75% FCmax.`,
      cues: [`D+ cible : ~${Math.round(e * 1.4)} m`, 'Montées à 60–75% FC max', 'Descentes prudence côté Saône'],
    },
    {
      tag: 'RÉCUPÉRATION ACTIVE', color: tokens.blue,
      title: 'Sortie légère',
      dist: Math.round(d * 0.62), elev: Math.round(e * 0.45), tss: Math.round(avgTSS * 0.5),
      tracks: [
        { name: 'Lentilly → Charbonnières',      dist: 16, elev: Math.round(e*0.4), tss: Math.round(avgTSS*0.45),
          waypoints: [[45.820,4.727],[45.799,4.756]] },
        { name: 'Limonest → Lentilly',           dist: 15, elev: Math.round(e*0.35), tss: Math.round(avgTSS*0.4),
          waypoints: [[45.857,4.758],[45.820,4.727]] },
        { name: 'Charbonnières → Marcy',         dist: 14, elev: Math.round(e*0.3), tss: Math.round(avgTSS*0.35),
          waypoints: [[45.799,4.756],[45.790,4.745]] },
        { name: 'Lentilly → Lozanne',            dist: 17, elev: Math.round(e*0.4), tss: Math.round(avgTSS*0.45),
          waypoints: [[45.820,4.727],[45.851,4.691]] },
        { name: 'Charbonnières → Vaugneray',     dist: 18, elev: Math.round(e*0.45), tss: Math.round(avgTSS*0.5),
          waypoints: [[45.799,4.756],[45.749,4.707]] },
      ],
      desc: `Zone 1–2 uniquement, 14–18 km. TSS cible < ${Math.round(avgTSS * 0.55)}.`,
      cues: ['FC < 65% FCmax strictement', 'Terrain roulant', 'Effort ressenti 4/10 max'],
    },
    {
      tag: 'COURSE AUX KM +20%', color: '#9b6fb5',
      title: 'Longue distance',
      dist: Math.round(d * 1.2), elev: e, tss: Math.round(avgTSS * 1.2),
      tracks: [
        { name: 'Lozanne → Saint-Romain → Lentilly',   dist: 30, elev: Math.round(e*1.0), tss: Math.round(avgTSS*1.15),
          waypoints: [[45.851,4.691],[45.839,4.652],[45.820,4.727]] },
        { name: 'Chessy → Saint-Romain',                dist: 32, elev: Math.round(e*1.1), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.898,4.688],[45.839,4.652]] },
        { name: 'Vaugneray → Lentilly → Limonest',      dist: 30, elev: Math.round(e*0.95), tss: Math.round(avgTSS*1.15),
          waypoints: [[45.749,4.707],[45.820,4.727],[45.857,4.758]] },
        { name: 'Val d\'Oingt → Lentilly',              dist: 32, elev: Math.round(e*1.05), tss: Math.round(avgTSS*1.2),
          waypoints: [[45.909,4.668],[45.820,4.727]] },
        { name: 'Neuville → Limonest → Saint-Cyr',      dist: 30, elev: Math.round(e*1.2), tss: Math.round(avgTSS*1.25),
          waypoints: [[45.882,4.843],[45.857,4.758],[45.858,4.793]] },
      ],
      desc: `+${Math.round(d * 0.2)} km de volume (~30 km). Z2, temps en selle maximal.`,
      cues: ['Rythme Z2 constant', 'Ravitaillement toutes les 45 min', 'Ne pas forcer en montée'],
    },
    {
      tag: 'KM + DÉNIVELÉ +20%/+15%', color: '#c4602a',
      title: 'Volume & relief',
      dist: Math.round(d * 1.2), elev: Math.round(e * 1.15), tss: Math.round(avgTSS * 1.35),
      tracks: [
        { name: 'Saint-Cyr → Chessy → Lentilly',        dist: 30, elev: Math.round(e*1.3), tss: Math.round(avgTSS*1.3),
          waypoints: [[45.858,4.793],[45.898,4.688],[45.820,4.727]] },
        { name: 'Poleymieux → Chessy → Lozanne',        dist: 28, elev: Math.round(e*1.35), tss: Math.round(avgTSS*1.35),
          waypoints: [[45.892,4.776],[45.898,4.688],[45.851,4.691]] },
        { name: 'Saint-Cyr → Lozanne → Vaugneray',      dist: 32, elev: Math.round(e*1.3), tss: Math.round(avgTSS*1.35),
          waypoints: [[45.858,4.793],[45.851,4.691],[45.749,4.707]] },
        { name: 'Curis → Chessy → Lentilly',            dist: 30, elev: Math.round(e*1.35), tss: Math.round(avgTSS*1.4),
          waypoints: [[45.903,4.830],[45.898,4.688],[45.820,4.727]] },
        { name: 'Poleymieux → Limonest → Vaugneray',    dist: 30, elev: Math.round(e*1.3), tss: Math.round(avgTSS*1.35),
          waypoints: [[45.892,4.776],[45.857,4.758],[45.749,4.707]] },
      ],
      desc: `+${Math.round(d * 0.2)} km ET +${Math.round(e * 0.15)} m D+. Sortie exigeante (~30 km).`,
      cues: ['Gérer l\'effort sur les cols', 'Ravitaillement solide', 'Récup complète le lendemain'],
    },
    {
      tag: '40-60KM', color: '#5a7a9e',
      title: 'Grande boucle',
      dist: 50, elev: Math.round(e * 1.3), tss: Math.round(avgTSS * 1.5),
      tracks: [
        { name: '~40km · Chessy → Saint-Romain → Vaugneray',          dist: 40, elev: 500, tss: 108,
          waypoints: [[45.898,4.688],[45.839,4.652],[45.749,4.707]] },
        { name: '~43km · Poleymieux → Saint-Romain → Lentilly',        dist: 43, elev: 540, tss: 116,
          waypoints: [[45.892,4.776],[45.839,4.652],[45.820,4.727]] },
        { name: '~46km · Saint-Cyr → Lozanne → Saint-Romain',          dist: 46, elev: 580, tss: 128,
          waypoints: [[45.858,4.793],[45.851,4.691],[45.839,4.652]] },
        { name: '~50km · Poleymieux → L\'Arbresle → Vaugneray',        dist: 50, elev: 620, tss: 140,
          waypoints: [[45.892,4.776],[45.837,4.619],[45.749,4.707]] },
        { name: '~54km · Neuville → L\'Arbresle → Sain-Bel',           dist: 54, elev: 660, tss: 156,
          waypoints: [[45.882,4.843],[45.837,4.619],[45.821,4.570]] },
        { name: '~57km · Saint-Cyr → L\'Arbresle → Tarare',            dist: 57, elev: 710, tss: 168,
          waypoints: [[45.858,4.793],[45.837,4.619],[45.898,4.431]] },
        { name: '~62km · Grande boucle : Chessy → Tarare → Vaugneray', dist: 62, elev: 760, tss: 185,
          waypoints: [[45.898,4.688],[45.837,4.619],[45.898,4.431],[45.749,4.707]] },
      ],
      desc: `7 tracés de 40 à 62 km. Choisis selon ta forme du jour.`,
      cues: ['Sortir tôt le matin', 'Prévoir 2 bidons + barre', 'Rythme Z2 sauf montées clés'],
    },
  ];

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <>
      {selected && (
        <RouteModal proposal={selected} activities={activities} onClose={() => setSelected(null)} />
      )}
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.green }}>§ ROUTES</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>6 SORTIES PROPOSÉES POUR TA PROGRESSION</Label>
      </div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginBottom: 20 }}>
        Basé sur tes 5 dernières sorties · dist. moy. {avgDist} km · D+ moy. {avgElev} m · TSS moy. {avgTSS} · <em>Clique sur une carte pour voir le tracé</em>
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
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>VOIR LE TRACÉ →</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink, marginBottom: 12 }}>{p.title}</div>
              <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: `1px solid ${tokens.creamBorder}`, paddingBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ display: 'block', marginBottom: 2 }}>DISTANCE</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>{p.dist}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 2 }}>km</span></span>
                </div>
                <div style={{ flex: 1 }}>
                  <Label style={{ display: 'block', marginBottom: 2 }}>D+</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>{p.elev}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 2 }}>m</span></span>
                </div>
                <div style={{ flex: 1 }}>
                  <Label style={{ display: 'block', marginBottom: 2 }}>TSS</Label>
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

// ── Last 5 averages ───────────────────────────────────────────────────────────

function avg(vals: (number | null | undefined)[]): number | null {
  const clean = vals.filter((v): v is number => v != null);
  return clean.length ? +(clean.reduce((s, v) => s + v, 0) / clean.length).toFixed(1) : null;
}

function avgInt(vals: (number | null | undefined)[]): number | null {
  const v = avg(vals);
  return v != null ? Math.round(v) : null;
}

function formatAvgDuration(activities: Activity[]): string | null {
  const mins = activities.map(a => a.duration_min).filter((v): v is number => v != null);
  if (!mins.length) return null;
  const m = Math.round(mins.reduce((s, v) => s + v, 0) / mins.length);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Stat({ label, value, unit, color }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 80 }}>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.08em', color: tokens.inkLight, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 700, color: color ?? tokens.ink, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function Last5Stats({ activities }: { activities: Activity[] }) {
  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  if (last5.length < 2) return null;

  const dur      = formatAvgDuration(last5);
  const dist     = avg(last5.map(a => a.distance));
  const elev     = avgInt(last5.map(a => a.elevation));
  const speed    = avg(last5.map(a => a.speed));
  const hr       = avgInt(last5.map(a => a.avg_hr));
  const np       = avgInt(last5.map(a => a.np));
  const avgPower = avgInt(last5.map(a => a.avg_power));
  const tss      = avgInt(last5.map(a => a.tss));
  const wkg      = avg(last5.map(a => a.wkg));
  const cal      = avgInt(last5.map(a => a.calories));

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.blue }}>§ MOYENNE</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>5 DERNIÈRES SORTIES</Label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 40px', paddingBottom: 20, borderBottom: `1px solid ${tokens.creamBorder}`, marginBottom: 20 }}>
        <Stat label="Durée"     value={dur}   />
        <Stat label="Distance"  value={dist}  unit="km" />
        <Stat label="D+"        value={elev}  unit="m" />
        <Stat label="Vitesse"   value={speed} unit="km/h" />
        {hr       && <Stat label="FC moy"   value={hr}       unit="bpm" color={tokens.terra} />}
        {avgPower && <Stat label="Puis. moy" value={avgPower} unit="W"   color={tokens.green} />}
        {np       && <Stat label="NP moy"    value={np}       unit="W"   color={tokens.green} />}
        {tss      && <Stat label="TSS"       value={tss}                 color={tokens.terra} />}
        {wkg && <Stat label="W/kg"     value={wkg}            color={tokens.blue}  />}
        {cal && <Stat label="Calories" value={cal}  unit="kcal" />}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {last5.map((a, i) => (
          <div key={a.id} style={{
            flex: 1, minWidth: 120, padding: '10px 14px',
            background: tokens.creamDark, borderRadius: 3,
            borderTop: `3px solid ${i === 0 ? tokens.terra : tokens.creamBorder}`,
          }}>
            <Label style={{ display: 'block', marginBottom: 4, fontSize: 9 }}>{a.date}</Label>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: 15, fontWeight: 700, color: tokens.ink, marginBottom: 2 }}>{a.distance} km</div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>{a.elevation} m · {a.duration}</div>
            {a.tss != null && <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.terra, marginTop: 2 }}>TSS {a.tss}</div>}
            {a.avg_power != null && <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.green, marginTop: 1 }}>{a.avg_power} W moy.</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FeedPage ──────────────────────────────────────────────────────────────────

interface Props {
  activities: Activity[];
  stats: GlobalStats;
  onSelect: (a: Activity) => void;
}

export function FeedPage({ activities, stats, onSelect }: Props) {
  const isMobile = useIsMobile();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={1} title="ACTIVITÉS RÉCENTES" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32 }}>
        {stats.totalActivities} sorties.<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>Toujours plus loin.</em>
      </h1>

      <TrainingProgram activities={activities} />
      <Last5Stats activities={activities} />
      <RouteProposals activities={activities} />

      {activities.map(a => <ActivityCard key={a.id} activity={a} onClick={onSelect} />)}
    </div>
  );
}
