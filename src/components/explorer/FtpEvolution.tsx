'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Scatter, ReferenceDot,
} from 'recharts';
import { Activity, tokens } from './tokens';
import { Label, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';

interface Point {
  ts: number;       // unix ms (X axis)
  date: string;     // ISO YYYY-MM-DD
  ftp: number;      // rolling FTP estimate
  best20: number | null; // raw best 20 min on this ride
  isPr: boolean;    // did this ride beat the previous max?
}

function buildSeries(activities: Activity[]): Point[] {
  const eligible = activities
    .filter(a => a.original_type !== 'EBikeRide')
    .filter(a => !/électrique|electrique|e[- ]?bike|assistance/i.test(a.title || ''))
    .filter(a => (a.bestEfforts?.s1200 ?? null) != null)
    .sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime());

  let runningMax = 0;
  return eligible.map(a => {
    const v = a.bestEfforts!.s1200!;
    const isPr = v > runningMax;
    if (isPr) runningMax = v;
    return {
      ts:    new Date(a.rawDate).getTime(),
      date:  a.rawDate.slice(0, 10),
      ftp:   Math.round(runningMax * 0.95),
      best20: v,
      isPr,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTooltip(t: (k: string, v?: any) => string, lang: 'fr' | 'en') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as Point;
    return (
      <div style={{
        background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
        borderRadius: 4, padding: '8px 10px',
        fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.ink,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{formatDateLocale(p.date, lang)}</div>
        <div style={{ color: tokens.terra }}>FTP : <strong>{p.ftp} W</strong></div>
        {p.best20 != null && <div style={{ color: tokens.green }}>best 20 min : {p.best20} W</div>}
        {p.isPr && <div style={{ color: tokens.terra, marginTop: 2, fontWeight: 700 }}>★ {t('ftpEvol.newPr')}</div>}
      </div>
    );
  };
}

export function FtpEvolution({ activities }: { activities: Activity[] }) {
  const { t, lang } = useT();
  const isMobile = useIsMobile();
  const series = buildSeries(activities);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 24,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.terra }}>{t('ftpEvol.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('ftpEvol.label')}</Label>
      </div>

      {series.length < 2 ? (
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, padding: 20 }}>
          {t('ftpEvol.empty')}
        </div>
      ) : (
        <div style={{ width: '100%', height: isMobile ? 220 : 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={ms => formatDateLocale(new Date(ms).toISOString(), lang, { day: '2-digit', month: 'short' })}
                tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                axisLine={{ stroke: tokens.creamBorder }}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                width={40}
                tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                tickFormatter={v => `${v}W`}
                domain={['dataMin - 10', 'dataMax + 10']}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={buildTooltip(t, lang)} />
              <Line
                type="stepAfter"
                dataKey="ftp"
                stroke={tokens.terra}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: tokens.terra, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              {/* PR markers as reference dots */}
              {series.filter(p => p.isPr).map(p => (
                <ReferenceDot key={p.ts} x={p.ts} y={p.ftp} r={5} fill={tokens.terra} stroke="#fff" strokeWidth={2} />
              ))}
              {/* Hidden scatter so each ride is hoverable */}
              <Scatter dataKey="ftp" fill="transparent" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
