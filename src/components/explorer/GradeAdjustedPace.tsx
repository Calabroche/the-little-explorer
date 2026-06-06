'use client';

import { Activity, tokens } from './tokens';
import { useT } from '@/i18n';
import { Label } from './ui';

// Grade-Adjusted Pace (GAP): the flat-equivalent pace, correcting for hills.
// Strava puts this behind its paywall. We use Minetti's energy cost of
// running C(i) — the metabolic cost per metre at gradient i — and weight each
// segment's time by C(flat)/C(i): uphill segments count as "faster-equivalent".
const C_FLAT = 3.6; // J/kg/m on the flat
function minettiCost(grade: number): number {
  const i = Math.max(-0.45, Math.min(0.45, grade)); // clamp to keep the polynomial sane
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}
function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function GradeAdjustedPace({ activity }: { activity: Activity }) {
  const { lang } = useT();
  const en = lang === 'en';
  if (activity.type !== 'running') return null;

  const alt = activity.altitude ?? [];
  const dist = activity.distance_m ?? [];
  const time = activity.time_s ?? [];
  const len = Math.min(alt.length, dist.length, time.length);
  if (len < 10) return null;

  let gapTime = 0, totalDist = 0, totalTime = 0;
  for (let i = 1; i < len; i++) {
    const dD = dist[i] - dist[i - 1];
    const dT = time[i] - time[i - 1];
    const dA = alt[i] - alt[i - 1];
    if (dD <= 0 || dT <= 0 || dT > 20) continue; // skip pauses / GPS gaps
    const grade = dA / dD;
    gapTime += dT * (C_FLAT / minettiCost(grade));
    totalDist += dD;
    totalTime += dT;
  }
  if (totalDist < 500) return null;

  const gapPace = gapTime / (totalDist / 1000);
  const actualPace = totalTime / (totalDist / 1000);
  const delta = actualPace - gapPace; // >0 → GAP is faster (hilly route)

  return (
    <div style={{ ...CARD, marginBottom: 20, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div>
        <Label style={{ display: 'block', marginBottom: 4 }}>{en ? 'GRADE-ADJUSTED PACE' : 'ALLURE AJUSTÉE À LA PENTE'}</Label>
        <div style={{ fontFamily: "'Playfair Display'", fontSize: 30, fontWeight: 900, color: tokens.ink, lineHeight: 1 }}>
          {fmtPace(gapPace)} <span style={{ fontSize: 13, fontFamily: "'Space Grotesk'", color: tokens.inkLight, fontWeight: 400 }}>/km</span>
        </div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, lineHeight: 1.7 }}>
        <div>{en ? 'Real pace' : 'Allure réelle'} : <strong style={{ color: tokens.ink }}>{fmtPace(actualPace)}/km</strong></div>
        <div>
          {Math.abs(delta) < 1
            ? (en ? 'Flat route — no adjustment.' : 'Parcours plat — pas d\'ajustement.')
            : delta > 0
              ? (en ? `${fmtPace(delta)}/km faster once flattened — hilly route.` : `${fmtPace(delta)}/km plus rapide à plat — parcours vallonné.`)
              : (en ? `${fmtPace(-delta)}/km slower once flattened — net downhill.` : `${fmtPace(-delta)}/km plus lent à plat — descente nette.`)}
        </div>
        <div style={{ color: tokens.inkLight }}>{en ? 'Strava charges for this.' : 'Strava fait payer ça.'}</div>
      </div>
    </div>
  );
}

const CARD: React.CSSProperties = {
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 4, padding: 20, borderLeft: `4px solid ${tokens.terra}`,
};
