'use client';

import { useT } from '@/i18n';
import { tokens } from './tokens';

// Shared "why we beat Strava" pitch — used on the onboarding welcome step,
// in the guide, and as a section of the "i" What's-New panel. Bilingual.

interface Pt { icon: string; fr: string; en: string }
const PITCH = {
  fr: "Garde Strava gratuit, branche The Little Explorer : analyse niveau Premium + planificateur type Komoot — gratuit, et sans capteur de puissance.",
  en: 'Keep Strava free, plug in The Little Explorer: Premium-level analysis + a Komoot-style route planner — free, and without a power meter.',
};
const POINTS: Pt[] = [
  { icon: '⚡', fr: 'Puissance & FTP estimées sans capteur — Strava exige un vrai capteur de puissance.',
               en: 'Estimated power & FTP without a sensor — Strava needs a real power meter.' },
  { icon: '💧', fr: 'Points de ravitaillement (eau / nourriture) le long du parcours — Strava et même Komoot ne le font pas.',
               en: "Resupply points (water / food) along your route — Strava and even Komoot don't." },
  { icon: '🛤️', fr: 'Types de chemins & surfaces par itinéraire (route, piste, chemin, asphalte / non-pavé).',
               en: 'Way-type & surface breakdown per route (road, cycleway, path, paved / unpaved).' },
  { icon: '🧠', fr: "Plan d'entraînement + prochaine sortie prescrite (TSS cible, règle des 10 %) — niveau TrainingPeaks.",
               en: 'Training plan + prescribed next ride (target TSS, the 10% rule) — TrainingPeaks-level.' },
  { icon: '🔧', fr: "Carnet d'entretien matériel (usure des pièces) — Strava ne suit que le kilométrage brut.",
               en: 'Gear maintenance log (wear-part tracking) — Strava only tracks raw mileage.' },
];

export function whyBetterTitle(en: boolean): string {
  return en ? 'How we beat Strava' : 'En quoi on est mieux que Strava ?';
}

/// `compact` drops the outer card chrome (for embedding inside another card,
/// e.g. the onboarding step or the "i" panel).
export function WhyBetterThanStrava({ showTitle = true, compact = false }: { showTitle?: boolean; compact?: boolean }) {
  const { lang } = useT();
  const en = lang === 'en';

  const inner = (
    <>
      {showTitle && (
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.terra, marginBottom: 8 }}>
          🟧 {whyBetterTitle(en)}
        </div>
      )}
      <p style={{ fontSize: 13, color: tokens.ink, lineHeight: 1.55, margin: '0 0 14px', fontWeight: 500 }}>
        {en ? PITCH.en : PITCH.fr}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {POINTS.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>{p.icon}</span>
            <span style={{ fontSize: 12.5, color: tokens.inkMid, lineHeight: 1.5 }}>{en ? p.en : p.fr}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: tokens.green }}>
        {en ? 'And all of it — free.' : "Et tout ça, gratuit."}
      </div>
    </>
  );

  if (compact) return <div>{inner}</div>;
  return (
    <div style={{
      background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 8, padding: 16,
    }}>
      {inner}
    </div>
  );
}
