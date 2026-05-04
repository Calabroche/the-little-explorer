'use client';

import { Activity, tokens } from './tokens';
import { Label } from './ui';
import { useT } from '@/i18n';
import { formatPace } from '@/utils/format';

// Critical Velocity (CV) — running analog of FTP.
// Take the best 20-minute pace across all running activities and apply the
// classic 0.95 multiplier. CV is then expressed in seconds per km.
function computeCV(activities: Activity[]): number | null {
  let bestPace: number | null = null;
  for (const a of activities) {
    if (a.type !== 'running') continue;
    const speed = a.speed_kmh ?? [];
    const dist  = a.distance_m ?? [];
    if (speed.length < 1200 || dist.length < 1200) continue; // need ≥ 20 min

    // Find the fastest 20 min window — assume 1 Hz sampling.
    const W = 1200;
    let lo = 0, hi = W;
    let best = Infinity;
    while (hi < dist.length) {
      const dM = dist[hi] - dist[lo];
      if (dM > 0) {
        const secPerKm = (W * 1000) / dM;
        if (secPerKm < best) best = secPerKm;
      }
      lo++; hi++;
    }
    if (isFinite(best) && (bestPace == null || best < bestPace)) {
      bestPace = best;
    }
  }
  if (bestPace == null) return null;
  // CV pace = best 20 min pace / 0.95 → makes the "threshold" feel slower
  // (in pace units, slower = bigger number, so we divide by 0.95 to add 5%).
  return bestPace / 0.95;
}

// Bracket pace zones around CV (Z1 slowest → Z5 fastest).
function buildZones(cv: number): { key: string; min: number; max: number; color: string }[] {
  return [
    { key: 'z1', min: cv / 0.70, max: Infinity,  color: tokens.green   }, // slower than 70% CV
    { key: 'z2', min: cv / 0.80, max: cv / 0.70, color: tokens.blue    },
    { key: 'z3', min: cv / 0.87, max: cv / 0.80, color: tokens.terra   },
    { key: 'z4', min: cv / 0.95, max: cv / 0.87, color: '#e07030'      },
    { key: 'z5', min: 0,         max: cv / 0.95, color: '#cc3333'      }, // faster than 95% CV
  ];
}

export function RunPaceZones({ activities }: { activities: Activity[] }) {
  const { t } = useT();
  const cv = computeCV(activities);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 24,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <Label style={{ color: tokens.green }}>{t('runZones.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('runZones.label')}</Label>
      </div>

      {cv == null ? (
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, padding: 12 }}>
          {t('runZones.empty')}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
            <Label>{t('runZones.cv')}</Label>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 28, fontWeight: 900, color: tokens.green }}>
              {formatPace(cv)}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, marginLeft: 3 }}>/km</span>
            </span>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
              {t('runZones.cvHint')}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {buildZones(cv).map(z => {
              const fast = z.max === Infinity ? null : z.max;
              const slow = z.min;
              const range = fast == null
                ? `> ${formatPace(slow)}`
                : z.min === 0
                  ? `< ${formatPace(fast)}`
                  : `${formatPace(fast)} – ${formatPace(slow)}`;
              return (
                <div key={z.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 12px', background: tokens.creamDark, borderRadius: 3,
                  borderLeft: `4px solid ${z.color}`,
                }}>
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700, color: z.color, minWidth: 130 }}>
                    {t(`runZones.${z.key}`)}
                  </span>
                  <span style={{ flex: 1, fontFamily: "'Playfair Display'", fontSize: 15, fontWeight: 700, color: tokens.ink }}>
                    {range}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 3 }}>/km</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
