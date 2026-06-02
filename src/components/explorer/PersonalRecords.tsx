'use client';

import { useMemo } from 'react';
import { Activity, tokens } from './tokens';
import { Label, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';
import { formatPace } from '@/utils/format';

const POWER_DURATIONS: { key: 's60'|'s300'|'s600'|'s1200'|'s1800'|'s3600'; label: string }[] = [
  { key: 's60',   label: '1 min' },
  { key: 's300',  label: '5 min' },
  { key: 's600',  label: '10 min' },
  { key: 's1200', label: '20 min' },
  { key: 's1800', label: '30 min' },
  { key: 's3600', label: '60 min' },
];

const RUN_DISTANCES = [1, 2, 5, 10, 21.1] as const;

interface PowerPr { label: string; value: number; date: string; title: string; }
interface PaceP   { km: number; secPerKm: number; date: string; title: string; }

function pickBestPower(activities: Activity[]): PowerPr[] {
  const out: PowerPr[] = [];
  for (const d of POWER_DURATIONS) {
    let best = 0, bestAct: Activity | null = null;
    for (const a of activities) {
      // skip e-bike rides
      if (a.original_type === 'EBikeRide') continue;
      if (/électrique|electrique|e[- ]?bike|assistance/i.test(a.title || '')) continue;
      const v = a.bestEfforts?.[d.key];
      if (v != null && v > best) { best = v; bestAct = a; }
    }
    if (bestAct && best > 0) {
      out.push({ label: d.label, value: best, date: bestAct.rawDate, title: bestAct.title });
    }
  }
  return out;
}

// Best running pace (sec/km) over various target distances.
// We sweep the speed_kmh stream and find the fastest TARGET-km window.
function pickBestPace(activities: Activity[], targetKm: number): PaceP | null {
  let best: PaceP | null = null;
  for (const a of activities) {
    if (a.type !== 'running') continue;
    const speed = a.speed_kmh ?? [];
    const dist  = a.distance_m ?? [];
    if (speed.length < 30 || dist.length < 30) continue;
    if (a.distance < targetKm) continue;

    // Slide a window indexed by distance — find the smallest time delta
    // covering exactly `targetKm` worth of distance.
    const targetM = targetKm * 1000;
    let lo = 0;
    let bestSec = Infinity;
    for (let hi = 1; hi < dist.length; hi++) {
      while (dist[hi] - dist[lo] >= targetM && lo < hi) {
        const dtSec = (hi - lo); // assuming 1 Hz samples
        if (dtSec < bestSec) bestSec = dtSec;
        lo++;
      }
    }
    if (isFinite(bestSec) && bestSec > 30) {
      const secPerKm = bestSec / targetKm;
      if (!best || secPerKm < best.secPerKm) {
        best = { km: targetKm, secPerKm, date: a.rawDate, title: a.title };
      }
    }
  }
  return best;
}

export function PersonalRecords({ activities, sport }: {
  activities: Activity[];
  sport: 'cycling' | 'running' | 'hiking' | 'ski' | 'snowshoe' | 'walking' | 'swim' | 'yoga' | 'workout' | 'other';
}) {
  const { t, lang } = useT();
  const isMobile = useIsMobile();

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 24,
  };

  // Memoised — both helpers sweep through 1Hz GPS streams of every
  // matching activity, which is O(N × stream-length). Without memo
  // they ran on every parent re-render (sidebar toggles, language
  // switches, hover state in siblings). Hooks MUST be called above
  // any early return so the hook order stays stable.
  const records = useMemo(
    () => sport === 'cycling' ? pickBestPower(activities) : [],
    [activities, sport],
  );
  const paces   = useMemo(
    () => sport === 'running'
      ? RUN_DISTANCES.map(d => pickBestPace(activities, d)).filter((p): p is PaceP => p !== null)
      : [],
    [activities, sport],
  );

  // Records only make sense for cycling (power) and running (pace). For other
  // sports we don't have a comparable benchmark — skip the section entirely.
  if (sport !== 'cycling' && sport !== 'running') return null;

  if (sport === 'cycling') {
    return (
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <Label style={{ color: tokens.terra }}>{t('records.tag')}</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>{t('records.label')}</Label>
        </div>
        {records.length === 0 ? (
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, padding: 8 }}>
            {t('records.noData')}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : `repeat(${records.length}, 1fr)`, gap: 8 }}>
            {records.map(r => (
              <div key={r.label} style={{
                padding: '12px 14px', background: tokens.creamDark, borderRadius: 3,
                borderTop: `2px solid ${tokens.terra}`,
              }}>
                <Label style={{ display: 'block', marginBottom: 4 }}>{t('records.best', { label: r.label })}</Label>
                <div style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 800, color: tokens.terra, lineHeight: 1 }}>
                  {r.value}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 3 }}>W</span>
                </div>
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginTop: 6, lineHeight: 1.4 }}>
                  {formatDateLocale(r.date, lang, { day: '2-digit', month: 'short' })}<br />
                  <span style={{ color: tokens.inkMid }}>{r.title.slice(0, 28)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Running (paces is memoised above)
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Label style={{ color: tokens.green }}>{t('records.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('records.labelRun')}</Label>
      </div>
      {paces.length === 0 ? (
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, padding: 8 }}>
          {t('records.noData')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : `repeat(${paces.length}, 1fr)`, gap: 8 }}>
          {paces.map(p => (
            <div key={p.km} style={{
              padding: '12px 14px', background: tokens.creamDark, borderRadius: 3,
              borderTop: `2px solid ${tokens.green}`,
            }}>
              <Label style={{ display: 'block', marginBottom: 4 }}>
                {p.km < 21 ? `${p.km} km` : 'Semi'}
              </Label>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 800, color: tokens.green, lineHeight: 1 }}>
                {formatPace(p.secPerKm)}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 3 }}>/km</span>
              </div>
              <div style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginTop: 6, lineHeight: 1.4 }}>
                {formatDateLocale(p.date, lang, { day: '2-digit', month: 'short' })}<br />
                <span style={{ color: tokens.inkMid }}>{p.title.slice(0, 28)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
