'use client';

import { useState, useMemo, useCallback, CSSProperties } from 'react';
import { Activity, tokens } from './tokens';
import { Label } from './ui';
import { useT } from '@/i18n';

// Match iOS: build a wide window then trim the leading empty weeks so
// the heatmap doesn't waste space showing Jan/Feb at 0 activity for an
// account that started riding in March. Anchored on the right at the
// current week. (ActivityCalendar.swift commits f33fbe4 + 6de93c0.)
const WEEKS_MAX = 20;
const DAYS_MAX  = WEEKS_MAX * 7;

// LOCAL-TZ iso day formatter — was using d.toISOString() which converts
// to UTC and silently dropped activities into the wrong cell when the
// browser TZ ≠ UTC and the activity timestamp was near midnight
// (e.g. an evening ride at 23:30 local → 21:30 UTC the same day, fine;
// but an evening ride at 00:30 local → 22:30 UTC the *previous* day,
// landing in the wrong cell). Now both the grid keys AND the activity
// keys (which come from a.rawDate.slice(0,10) — already local) align.
function isoDay(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function startOfMonday(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  const out = new Date(d);
  out.setDate(d.getDate() - dow);
  out.setHours(0, 0, 0, 0);
  return out;
}

interface DayCell {
  iso:              string;
  date:             Date;
  activities:       Activity[];
  totalKm:          number;
  totalElevationM:  number;
  totalDurationMin: number;
  inFuture:         boolean;
}

function buildCells(activities: Activity[]): DayCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastMonday = startOfMonday(today);
  const start = new Date(lastMonday);
  start.setDate(lastMonday.getDate() - (WEEKS_MAX - 1) * 7);

  const byDay = new Map<string, Activity[]>();
  for (const a of activities) {
    const iso = a.rawDate.slice(0, 10);
    const arr = byDay.get(iso) ?? [];
    arr.push(a);
    byDay.set(iso, arr);
  }

  const cells: DayCell[] = [];
  const cur = new Date(start);
  for (let i = 0; i < DAYS_MAX; i++) {
    const iso = isoDay(cur);
    const acts = byDay.get(iso) ?? [];
    // Single-pass aggregation so 140 cells × 3 reduce()s don't become
    // the framerate bottleneck while the user hovers.
    let totalKm = 0, totalElev = 0, totalDur = 0;
    for (const a of acts) {
      totalKm   += a.distance ?? 0;
      totalElev += a.elevation ?? 0;
      totalDur  += a.duration_min ?? 0;
    }
    cells.push({
      iso,
      date: new Date(cur),
      activities:       acts,
      totalKm,
      totalElevationM:  totalElev,
      totalDurationMin: totalDur,
      inFuture:         cur.getTime() > today.getTime(),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return cells;
}

/** Trim contiguous leading weeks that have zero activity. */
function trimLeadingEmptyWeeks(cells: DayCell[]): DayCell[] {
  const totalWeeks = cells.length / 7;
  let firstActive = 0;
  for (let w = 0; w < totalWeeks; w++) {
    const wkCells = cells.slice(w * 7, w * 7 + 7);
    const hasAny  = wkCells.some(c => c.activities.length > 0);
    if (hasAny) { firstActive = w; break; }
    // If we never find an active week, keep the last 4 weeks at least
    // (so the card still has something visible).
    if (w === totalWeeks - 1) firstActive = Math.max(0, totalWeeks - 4);
  }
  return cells.slice(firstActive * 7);
}

// Colour ramps on distance now (was TSS). Bins chosen for cycling-
// dominant data but still readable for runs / walks. (Matches iOS
// `intensityColor(km:)`.)
function intensityColor(km: number, hasActivity: boolean): string {
  if (!hasActivity) return tokens.creamDark;
  if (km >= 60) return '#9b3a1a';
  if (km >= 30) return '#c4602a';
  if (km >= 15) return '#e08a4d';
  return '#f3b585';
}

const LEGEND_COLORS = [tokens.creamDark, '#f3b585', '#e08a4d', '#c4602a', '#9b3a1a'];

function avgSpeedKmh(cell: DayCell): number | null {
  if (cell.totalDurationMin <= 0 || cell.totalKm <= 0) return null;
  return cell.totalKm / (cell.totalDurationMin / 60);
}

export function ActivityCalendar({ activities }: { activities: Activity[] }) {
  const { t, lang } = useT();
  const [hover, setHover] = useState<DayCell | null>(null);

  // Memoise the grid so it doesn't get rebuilt every time the hover
  // state flips. With 140 cells × month-label string formatting, doing
  // this on every render was making the cursor stutter / freeze.
  const cells = useMemo(() => trimLeadingEmptyWeeks(buildCells(activities)), [activities]);
  const weeks = cells.length / 7;

  const cols = useMemo<DayCell[][]>(() => {
    const out: DayCell[][] = [];
    for (let w = 0; w < weeks; w++) out.push(cells.slice(w * 7, w * 7 + 7));
    return out;
  }, [cells, weeks]);

  // Lookup by isoDay so the delegated mouseover handler can resolve
  // event.target → DayCell in O(1).
  const cellsByIso = useMemo(() => {
    const m = new Map<string, DayCell>();
    for (const c of cells) m.set(c.iso, c);
    return m;
  }, [cells]);

  const monthLabels = useMemo(() => {
    const monthAt = cols.map(col => col[0]?.date.getMonth() ?? 0);
    return cols.map((col, i) => {
      const m = monthAt[i];
      const prev = i > 0 ? monthAt[i - 1] : -1;
      if (m === prev) return '';
      return col[0]?.date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'short' }).replace('.', '');
    });
  }, [cols, lang]);

  const dayLabels   = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const dayLabelsEn = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayShort    = lang === 'en' ? dayLabelsEn : dayLabels;

  // Event delegation: ONE handler on the grid wrapper instead of 140
  // per-cell inline closures. Eliminates the per-render allocation
  // of 140 new fn refs (which was forcing React to swap listeners
  // on every cell on every hover flip → measurable jank on the home
  // page where the heatmap sits above other heavy widgets).
  const handleGridMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const iso = target?.getAttribute?.('data-iso');
    if (!iso) return;
    const cell = cellsByIso.get(iso);
    if (cell) setHover(cell);
  }, [cellsByIso]);
  const handleGridMouseLeave = useCallback(() => setHover(null), []);

  const CELL    = 14;
  const GAP     = 3;
  const LABEL_W = 14;

  const CARD: CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: '14px 16px', marginBottom: 24,
    position: 'relative', // anchors the absolute-positioned tooltip
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Label style={{ color: tokens.terra }}>{t('calendar.tag')}</Label>
          <div style={{ width: 16, height: 1, background: tokens.creamBorder }} />
          <Label>{t('calendar.label')}</Label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
          <span>{t('calendar.legend')}</span>
          {LEGEND_COLORS.map((c, i) => (
            <span key={i} style={{ display: 'inline-block', width: 9, height: 9, background: c, border: `1px solid ${tokens.creamBorder}`, borderRadius: 2 }} />
          ))}
          <span>{t('calendar.legendHi')}</span>
        </div>
      </div>

      <div
        style={{ position: 'relative', display: 'inline-block' }}
        onMouseOver={handleGridMouseOver}
        onMouseLeave={handleGridMouseLeave}
      >
        <div style={{
          display: 'grid', gridTemplateColumns: `${LABEL_W}px repeat(${weeks}, ${CELL}px)`, gap: GAP,
          fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight,
          marginBottom: 3, textTransform: 'capitalize',
        }}>
          <span></span>
          {monthLabels.map((m, i) => <span key={i} style={{ overflow: 'visible', whiteSpace: 'nowrap' }}>{m}</span>)}
        </div>

        {[0, 1, 2, 3, 4, 5, 6].map(row => (
          <div key={row} style={{
            display: 'grid', gridTemplateColumns: `${LABEL_W}px repeat(${weeks}, ${CELL}px)`, gap: GAP, marginBottom: GAP,
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, textAlign: 'center', lineHeight: `${CELL}px` }}>
              {row % 2 === 0 ? dayShort[row] : ''}
            </span>
            {cols.map((col, w) => {
              const c = col[row];
              if (!c) return <span key={w} />;
              const bg = intensityColor(c.totalKm, c.activities.length > 0);
              return (
                <span key={w}
                  data-iso={c.iso}
                  style={{
                    width: CELL, height: CELL,
                    background: c.inFuture ? 'transparent' : bg,
                    border: `1px solid ${c.inFuture ? 'transparent' : tokens.creamBorder}`,
                    borderRadius: 2, cursor: c.activities.length > 0 ? 'pointer' : 'default',
                  }}
                />
              );
            })}
          </div>
        ))}

        {/* Tooltip: absolutely positioned just below the grid, OVERLAYS
            whatever sits in the card's margin / next widget area for
            the duration of the hover. The card itself stays at its
            natural compact height when no cell is hovered (no more
            56px dead space), and crucially no layout reflow happens
            on hover transitions — the FeedPage widgets downstream
            don't get touched. */}
        {hover && (() => {
        const dateLbl = hover.date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR',
          { weekday: 'short', day: 'numeric', month: 'short' });
        const empty   = hover.activities.length === 0;
        const speed   = avgSpeedKmh(hover);
        return (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0,
            padding: '10px 14px',
            background: tokens.surface,
            border: `1px solid ${tokens.creamBorder}`,
            boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
            borderRadius: 6, minWidth: 240, zIndex: 5,
            // Tiny fade-in so the tooltip doesn't pop in like a jumpscare.
            animation: 'tle-cal-tooltip-in 110ms ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: empty ? 0 : 6 }}>
              <span style={{ fontFamily: "'Playfair Display'", fontWeight: 700, fontSize: 12, color: tokens.ink, textTransform: 'capitalize' }}>
                {dateLbl}
              </span>
              {hover.activities.length > 1 && (
                <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
                  · {hover.activities.length} {t('calendar.rides')}
                </span>
              )}
            </div>
            {empty ? (
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontStyle: 'italic', color: tokens.inkLight }}>
                {t('calendar.tooltipNone')}
              </span>
            ) : (
              <div style={{ display: 'flex', gap: 16 }}>
                <Chip label="KM"  value={hover.totalKm.toFixed(1)}            color={tokens.terra} />
                {speed != null && (
                  <Chip label="MOY" value={`${speed.toFixed(1)} km/h`}          color={tokens.blue}  />
                )}
                {hover.totalElevationM > 0 && (
                  <Chip label="D+"  value={`${Math.round(hover.totalElevationM)} m`} color={tokens.green} />
                )}
              </div>
            )}
          </div>
        );
      })()}
      </div>

      {/* Spacer that grows the card downward when a cell is hovered,
          so the tooltip fits INSIDE the card instead of overlapping
          the next widget. Height transitions over 180ms — smooth
          enough to feel deliberate, fast enough to not feel laggy.
          Critically, the height is keyed on `!!hover` (boolean), not
          on the specific cell, so moving the cursor across cells
          doesn't re-trigger the transition: the spacer stays open
          for the whole grid-hover session and the cell change only
          updates the tooltip's content. ONE reflow on grid-enter,
          ONE on grid-leave — no per-cell thrash. */}
      <div
        aria-hidden
        style={{
          height: hover ? 70 : 0,
          transition: 'height 180ms ease',
          marginTop: hover ? 8 : 0,
        }}
      />
    </div>
  );
}

// Small stat chip inside the tooltip card (label + value, two-line).
function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: tokens.inkLight }}>
        {label}
      </span>
      <span style={{ fontFamily: "'Playfair Display'", fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}
