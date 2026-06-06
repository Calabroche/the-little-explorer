'use client';

import { useMemo } from 'react';
import { useT } from '@/i18n';
import { tokens, Activity } from './tokens';
import { Label } from './ui';

// Free race-time predictor + training paces for runners — the kind of thing
// Strava puts behind its paywall (Performance Predictions). Uses Riegel's
// endurance formula T2 = T1 · (D2/D1)^1.06 from the runner's best recent
// effort, then derives Daniels-style training paces from the predictions.

const RIEGEL = 1.06;
const TARGETS: { km: number; label: string }[] = [
  { km: 5,       label: '5 km' },
  { km: 10,      label: '10 km' },
  { km: 21.0975, label: 'Semi' },
  { km: 42.195,  label: 'Marathon' },
];

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function RaceProjector({ activities }: { activities: Activity[] }) {
  const { lang } = useT();
  const en = lang === 'en';

  // Reference effort = the running activity whose Riegel-equivalent 10 km
  // time is the fastest (best performance), distance ≥ 3 km.
  const ref = useMemo(() => {
    let best: { d: number; t: number; equiv: number } | null = null;
    for (const a of activities) {
      if (a.type !== 'running') continue;
      const d = a.distance;
      if (!d || d < 3) continue;
      const t = a.pace_s_per_km ? a.pace_s_per_km * d : (a.duration_min ? a.duration_min * 60 : 0);
      if (!t || t < 60) continue;
      const equiv = t * Math.pow(10 / d, RIEGEL);
      if (!best || equiv < best.equiv) best = { d, t, equiv };
    }
    return best;
  }, [activities]);

  if (!ref) return null;

  const predict = (km: number) => ref.t * Math.pow(km / ref.d, RIEGEL);
  const preds = TARGETS.map(tg => ({ ...tg, sec: predict(tg.km), pace: predict(tg.km) / tg.km }));

  const marathonPace = predict(42.195) / 42.195;
  const tenKPace = predict(10) / 10;
  const fiveKPace = predict(5) / 5;
  const paces: { fr: string; en: string; sec: number; color: string }[] = [
    { fr: 'Endurance facile', en: 'Easy',      sec: marathonPace + 50, color: tokens.green },
    { fr: 'Allure marathon',  en: 'Marathon',  sec: marathonPace,      color: tokens.blue  },
    { fr: 'Seuil (tempo)',    en: 'Threshold', sec: tenKPace,          color: tokens.terra },
    { fr: 'VO2 / Intervalle', en: 'Interval',  sec: fiveKPace,         color: '#C0392B'    },
  ];

  const card: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 20, marginTop: 16,
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Label style={{ color: tokens.terra }}>{en ? 'PROJECTION' : 'PROJECTION'}</Label>
        <Label>{en ? 'PREDICTED RACE TIMES' : 'CHRONOS PRÉDITS'}</Label>
        <span style={{ marginLeft: 'auto', fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
          {en ? 'from your best ' : 'depuis ton meilleur '}{ref.d.toFixed(1)} km
        </span>
      </div>

      {/* Predicted times */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {preds.map(p => (
          <div key={p.label} style={{ background: tokens.creamDark, borderRadius: 6, padding: '10px 8px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em', marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: 19, fontWeight: 800, color: tokens.ink, lineHeight: 1 }}>{fmtTime(p.sec)}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: tokens.inkMid, marginTop: 3 }}>{fmtPace(p.pace)}/km</div>
          </div>
        ))}
      </div>

      {/* Training paces */}
      <Label style={{ display: 'block', marginBottom: 10 }}>{en ? 'TRAINING PACES' : "ALLURES D'ENTRAÎNEMENT"}</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {paces.map(z => (
          <div key={z.fr} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${tokens.creamBorder}` }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: z.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink }}>{en ? z.en : z.fr}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: tokens.ink }}>{fmtPace(z.sec)}<span style={{ fontSize: 10, color: tokens.inkLight }}>/km</span></span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 10, fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, lineHeight: 1.5 }}>
        {en
          ? 'Estimates from the Riegel model — Strava charges for this. Train at these paces to hit the predicted times.'
          : 'Estimations via le modèle de Riegel — Strava fait payer ça. Cours à ces allures pour viser les chronos prédits.'}
      </p>
    </div>
  );
}
