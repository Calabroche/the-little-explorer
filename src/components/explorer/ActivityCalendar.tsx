'use client';

import { useState } from 'react';
import { Activity, tokens } from './tokens';
import { Label } from './ui';
import { useT } from '@/i18n';

const WEEKS = 12;
const DAYS = WEEKS * 7;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonday(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // 0 = Mon
  const out = new Date(d);
  out.setDate(d.getDate() - dow);
  out.setHours(0, 0, 0, 0);
  return out;
}

interface DayCell {
  iso: string;
  date: Date;
  activities: Activity[];
  totalKm: number;
  totalTss: number;
  inFuture: boolean;
}

function buildGrid(activities: Activity[]): DayCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastMonday = startOfMonday(today);
  const start = new Date(lastMonday);
  start.setDate(lastMonday.getDate() - (WEEKS - 1) * 7);

  // Group activities by ISO day.
  const byDay = new Map<string, Activity[]>();
  for (const a of activities) {
    const iso = a.rawDate.slice(0, 10);
    const arr = byDay.get(iso) ?? [];
    arr.push(a);
    byDay.set(iso, arr);
  }

  const cells: DayCell[] = [];
  const cur = new Date(start);
  for (let i = 0; i < DAYS; i++) {
    const iso = isoDay(cur);
    const acts = byDay.get(iso) ?? [];
    cells.push({
      iso,
      date: new Date(cur),
      activities: acts,
      totalKm:  Math.round(acts.reduce((s, a) => s + a.distance, 0)),
      totalTss: acts.reduce((s, a) => s + (a.tss ?? 0), 0),
      inFuture: cur.getTime() > today.getTime(),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return cells;
}

function intensityColor(tss: number, hasActivity: boolean): { bg: string; level: number } {
  if (!hasActivity) return { bg: tokens.creamDark, level: 0 };
  if (tss >= 100) return { bg: '#9b3a1a', level: 4 };
  if (tss >= 60)  return { bg: '#c4602a', level: 3 };
  if (tss >= 30)  return { bg: '#e08a4d', level: 2 };
  return { bg: '#f3b585', level: 1 };
}

const LEGEND_COLORS = [tokens.creamDark, '#f3b585', '#e08a4d', '#c4602a', '#9b3a1a'];

export function ActivityCalendar({ activities }: { activities: Activity[] }) {
  const { t, lang } = useT();
  const cells = buildGrid(activities);
  const [hover, setHover] = useState<DayCell | null>(null);

  // Build columns: 12 weeks × 7 days.
  const cols: DayCell[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    cols.push(cells.slice(w * 7, w * 7 + 7));
  }

  // Tooltip text.
  const tooltipText = (() => {
    if (!hover) return null;
    const dateLbl = hover.date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR',
      { weekday: 'short', day: 'numeric', month: 'short' });
    if (hover.activities.length === 0) return `${dateLbl} — ${t('calendar.tooltipNone')}`;
    const km = hover.activities.reduce((s, a) => s + a.distance, 0).toFixed(0);
    const tss = Math.round(hover.totalTss);
    const key = hover.activities.length === 1 ? 'calendar.tooltipOne' : 'calendar.tooltipMany';
    return `${dateLbl} — ${t(key, { n: hover.activities.length, km, tss })}`;
  })();

  // Day labels (Mon..Sun).
  const dayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const dayLabelsEn = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayShort = lang === 'en' ? dayLabelsEn : dayLabels;

  // Month labels above columns: only when month changes between weeks.
  const monthAt = cols.map(col => col[0]?.date.getMonth() ?? 0);
  const monthLabels = cols.map((col, i) => {
    const m = monthAt[i];
    const prev = i > 0 ? monthAt[i - 1] : -1;
    if (m === prev) return '';
    return col[0]?.date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'short' }).replace('.', '');
  });

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Label style={{ color: tokens.terra }}>{t('calendar.tag')}</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>{t('calendar.label')}</Label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
          <span>{t('calendar.legend')}</span>
          {LEGEND_COLORS.map((c, i) => (
            <span key={i} style={{ display: 'inline-block', width: 10, height: 10, background: c, border: `1px solid ${tokens.creamBorder}`, borderRadius: 2 }} />
          ))}
          <span>{t('calendar.legendHi')}</span>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Month row */}
        <div style={{
          display: 'grid', gridTemplateColumns: `20px repeat(${WEEKS}, 1fr)`, gap: 4,
          fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight,
          marginBottom: 4, textTransform: 'capitalize',
        }}>
          <span></span>
          {monthLabels.map((m, i) => <span key={i}>{m}</span>)}
        </div>

        {/* 7 rows of cells, with day labels on the left. */}
        {[0, 1, 2, 3, 4, 5, 6].map(row => (
          <div key={row} style={{
            display: 'grid', gridTemplateColumns: `20px repeat(${WEEKS}, 1fr)`, gap: 4, marginBottom: 4,
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, textAlign: 'center' }}>
              {row % 2 === 0 ? dayShort[row] : ''}
            </span>
            {cols.map((col, w) => {
              const c = col[row];
              if (!c) return <span key={w} />;
              const { bg } = intensityColor(c.totalTss, c.activities.length > 0);
              return (
                <span key={w}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    aspectRatio: '1', background: c.inFuture ? 'transparent' : bg,
                    border: `1px solid ${c.inFuture ? 'transparent' : tokens.creamBorder}`,
                    borderRadius: 2, cursor: c.activities.length > 0 ? 'pointer' : 'default',
                    transition: 'transform 0.1s', minHeight: 12,
                  }}
                />
              );
            })}
          </div>
        ))}

        {/* Tooltip */}
        {tooltipText && (
          <div style={{
            marginTop: 10, padding: '6px 10px', background: tokens.creamDark,
            borderRadius: 3, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid,
          }}>{tooltipText}</div>
        )}
      </div>
    </div>
  );
}
