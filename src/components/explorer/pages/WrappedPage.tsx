'use client';

import { useState, useEffect, useMemo, useCallback, CSSProperties } from 'react';
import { Activity, tokens } from '../tokens';
import { useIsMobile } from '../ui';
import { useT, formatDateLocale } from '@/i18n';
import type { SportId } from '../Sidebar';

interface Props {
  activities: Activity[];
  // The currently-active sport. Caller already filtered `activities`
  // to this sport, but we keep the prop so card render functions can
  // tailor copy (e.g. the cover headline gets the sport name) and
  // sport-aggregate cards can self-hide when only one type is present.
  sport: SportId;
}

type YearStats = {
  year:           number;
  count:          number;
  distance:       number;
  elevation:      number;
  hours:          number;
  longest:        Activity | null;
  biggestClimb:   Activity | null;
  topSport:       { id: string; count: number; distance: number } | null;
  bestMonth:      { idx: number; distance: number } | null;
  bestDow:        { idx: number; count: number } | null;   // day of week (0 = mon)
  fastest:        Activity | null;                         // highest avg speed (rides only)
  mostKudosed:    Activity | null;
  monthlyDist:    number[];                                // 12
  distinctSports: number;                                  // # distinct sport types in this year's data
};

// Compute one year's recap from raw activities. Returns null if the year is empty.
function computeYear(acts: Activity[], year: number): YearStats | null {
  const ofYear = acts.filter(a => new Date(a.rawDate).getFullYear() === year);
  if (ofYear.length === 0) return null;

  const distance  = +ofYear.reduce((s, a) => s + a.distance, 0).toFixed(0);
  const elevation = +ofYear.reduce((s, a) => s + a.elevation, 0).toFixed(0);
  const hours     = Math.round(ofYear.reduce((s, a) => s + (a.duration_min ?? 0), 0) / 60);

  const longest = ofYear.reduce<Activity | null>(
    (best, a) => (!best || a.distance > best.distance ? a : best), null,
  );
  const biggestClimb = ofYear.reduce<Activity | null>(
    (best, a) => (!best || a.elevation > best.elevation ? a : best), null,
  );

  // Top sport by distance.
  const sportAgg: Record<string, { count: number; distance: number }> = {};
  for (const a of ofYear) {
    const e = sportAgg[a.type] ?? { count: 0, distance: 0 };
    e.count    += 1;
    e.distance += a.distance;
    sportAgg[a.type] = e;
  }
  const topSportEntry = Object.entries(sportAgg)
    .sort((a, b) => b[1].distance - a[1].distance)[0];
  const topSport = topSportEntry
    ? { id: topSportEntry[0], count: topSportEntry[1].count, distance: +topSportEntry[1].distance.toFixed(0) }
    : null;

  // Monthly distance distribution.
  const monthlyDist = Array(12).fill(0) as number[];
  for (const a of ofYear) {
    const m = new Date(a.rawDate).getMonth();
    monthlyDist[m] += a.distance;
  }
  const bestMonthIdx = monthlyDist.reduce((best, v, i) => (v > monthlyDist[best] ? i : best), 0);
  const bestMonth    = monthlyDist[bestMonthIdx] > 0
    ? { idx: bestMonthIdx, distance: +monthlyDist[bestMonthIdx].toFixed(0) }
    : null;

  // Day of week (Mon = 0).
  const dowCount = Array(7).fill(0) as number[];
  for (const a of ofYear) {
    const d = new Date(a.rawDate).getDay(); // 0 = Sun
    dowCount[(d + 6) % 7] += 1;             // shift so Mon = 0
  }
  const bestDowIdx = dowCount.reduce((best, v, i) => (v > dowCount[best] ? i : best), 0);
  const bestDow    = dowCount[bestDowIdx] > 0
    ? { idx: bestDowIdx, count: dowCount[bestDowIdx] }
    : null;

  // Fastest: any sport with a meaningful avg-speed reading. Used to be
  // hard-restricted to cycling, but since the page is now filtered by
  // sport at the call site (e.g. user on running → only running here),
  // we let cycling / running / ski all surface their fastest entry.
  // Floor of 4 km/h drops walking / very-low-speed outliers.
  const speedy  = ofYear.filter(a => a.speed != null && (a.speed ?? 0) >= 4);
  const fastest = speedy.reduce<Activity | null>(
    (best, a) => (!best || (a.speed ?? 0) > (best.speed ?? 0) ? a : best), null,
  );

  return {
    year,
    count: ofYear.length,
    distance, elevation, hours,
    longest, biggestClimb, topSport,
    bestMonth, bestDow, fastest, mostKudosed: null,
    monthlyDist: monthlyDist.map(v => +v.toFixed(0)),
    distinctSports: Object.keys(sportAgg).length,
  };
}

// ── Card definitions ─────────────────────────────────────────────────────────

type Card = {
  key:    string;
  bg:     string;             // gradient
  accent: string;             // accent text color
  fg:     string;             // primary text color
  render: (s: YearStats, t: (k: string, vars?: Record<string, string|number>) => string, lang: 'fr'|'en', isMobile: boolean) => React.ReactNode;
};

const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const DOW_KEYS   = ['mon','tue','wed','thu','fri','sat','sun'];
const SPORT_NAME_KEY: Record<string, string> = {
  cycling: 'common.cycling', running: 'common.running', hiking: 'common.hiking',
  ski: 'common.ski', snowshoe: 'common.snowshoe', walking: 'common.walking', swim: 'common.swim',
};

// Reusable big-number layout. Numbers come from Playfair, label from Space Grotesk.
function bigNumberCard(opts: {
  tagKey:   string;
  number:   string | number;
  unit?:    string;
  caption?: React.ReactNode;
  fg:       string;
  accent:   string;
  isMobile: boolean;
  t:        (k: string) => string;
}): React.ReactNode {
  const { tagKey, number, unit, caption, fg, accent, isMobile, t } = opts;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
      <span style={{
        fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
        letterSpacing: '0.18em', textTransform: 'uppercase', color: accent,
      }}>{t(tagKey)}</span>
      <div style={{
        fontFamily: "'Playfair Display'",
        fontSize: isMobile ? 80 : 140, fontWeight: 900,
        color: fg, lineHeight: 0.95, letterSpacing: '-0.02em',
      }}>
        {typeof number === 'number' ? number.toLocaleString() : number}
        {unit && <span style={{ fontFamily: "'Space Grotesk'", fontSize: isMobile ? 22 : 36, marginLeft: 12, color: accent }}>{unit}</span>}
      </div>
      {caption && (
        <div style={{
          fontFamily: "'Space Grotesk'", fontSize: isMobile ? 14 : 18,
          color: fg, opacity: 0.85, lineHeight: 1.5, maxWidth: 560,
        }}>
          {caption}
        </div>
      )}
    </div>
  );
}

// 4810m is the height of Mont Blanc — the user is in Annecy and references it
// in conversation, so it's a meaningful unit for "how much elevation."
const MONT_BLANC = 4810;

const CARDS: Card[] = [
  // 0 — Cover
  {
    key: 'cover',
    bg: `linear-gradient(135deg, ${tokens.terra} 0%, ${tokens.terraLight} 100%)`,
    accent: '#fff', fg: '#fff',
    render: (s, t, _l, isMobile) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
        <span style={{
          fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
          letterSpacing: '0.2em', textTransform: 'uppercase', color: '#fff', opacity: 0.9,
        }}>{t('wrapped.intro.tag')}</span>
        <div style={{
          fontFamily: "'Playfair Display'",
          fontSize: isMobile ? 96 : 200, fontWeight: 900,
          color: '#fff', lineHeight: 0.9, letterSpacing: '-0.03em',
        }}>{s.year}</div>
        <div style={{
          fontFamily: "'Playfair Display'", fontStyle: 'italic',
          fontSize: isMobile ? 22 : 36, color: '#fff', opacity: 0.95, lineHeight: 1.2,
        }}>{t('wrapped.intro.subtitle')}</div>
      </div>
    ),
  },

  // 1 — Total distance
  {
    key: 'distance',
    bg: `linear-gradient(160deg, ${tokens.cream} 0%, ${tokens.creamDark} 100%)`,
    accent: tokens.terra, fg: tokens.ink,
    render: (s, t, _l, isMobile) => bigNumberCard({
      tagKey: 'wrapped.distance.tag',
      number: s.distance, unit: 'km',
      caption: t('wrapped.distance.caption'),
      fg: tokens.ink, accent: tokens.terra, isMobile, t,
    }),
  },

  // 2 — Total elevation + Mont Blanc comparison
  {
    key: 'elevation',
    bg: `linear-gradient(160deg, ${tokens.cream} 0%, ${tokens.creamDark} 100%)`,
    accent: tokens.green, fg: tokens.ink,
    render: (s, t, _l, isMobile) => {
      const blancs = +(s.elevation / MONT_BLANC).toFixed(1);
      return bigNumberCard({
        tagKey: 'wrapped.elevation.tag',
        number: s.elevation, unit: 'm D+',
        caption: blancs >= 0.5
          ? <>{t('wrapped.elevation.caption').replace('{n}', String(blancs))}</>
          : null,
        fg: tokens.ink, accent: tokens.green, isMobile, t,
      });
    },
  },

  // 3 — Activity count + total hours
  {
    key: 'count',
    bg: `linear-gradient(135deg, ${tokens.green} 0%, ${tokens.greenLight} 100%)`,
    accent: '#fff', fg: '#fff',
    render: (s, t, _l, isMobile) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 720 }}>
        <span style={{
          fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.18em', textTransform: 'uppercase', color: '#fff', opacity: 0.9,
        }}>{t('wrapped.count.tag')}</span>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 24 : 56, alignItems: isMobile ? 'flex-start' : 'baseline' }}>
          <div>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 80 : 140, fontWeight: 900, color: '#fff', lineHeight: 0.9 }}>
              {s.count}
            </div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: '#fff', opacity: 0.85, marginTop: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {t('wrapped.count.activities')}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 56 : 90, fontWeight: 700, color: '#fff', opacity: 0.92, lineHeight: 0.9 }}>
              {s.hours}h
            </div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: '#fff', opacity: 0.85, marginTop: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {t('wrapped.count.hours')}
            </div>
          </div>
        </div>
      </div>
    ),
  },

  // 4 — Longest single ride/effort
  {
    key: 'longest',
    bg: `linear-gradient(160deg, ${tokens.cream} 0%, ${tokens.creamDark} 100%)`,
    accent: tokens.terra, fg: tokens.ink,
    render: (s, t, lang, isMobile) => {
      if (!s.longest) return null;
      return bigNumberCard({
        tagKey: 'wrapped.longest.tag',
        number: +s.longest.distance.toFixed(0), unit: 'km',
        caption: (
          <>
            <div style={{ fontFamily: "'Playfair Display'", fontStyle: 'italic', fontSize: isMobile ? 18 : 24, color: tokens.ink, marginBottom: 4 }}>
              {s.longest.title}
            </div>
            <div style={{ fontSize: 12, color: tokens.inkLight, letterSpacing: '0.05em' }}>
              {formatDateLocale(s.longest.rawDate, lang, { day: '2-digit', month: 'long', year: 'numeric' })}
              {s.longest.elevation ? ` · ${Math.round(s.longest.elevation).toLocaleString()} m D+` : ''}
            </div>
          </>
        ),
        fg: tokens.ink, accent: tokens.terra, isMobile, t,
      });
    },
  },

  // 5 — Biggest single climb
  {
    key: 'biggestClimb',
    bg: `linear-gradient(160deg, ${tokens.cream} 0%, ${tokens.creamDark} 100%)`,
    accent: tokens.blue, fg: tokens.ink,
    render: (s, t, lang, isMobile) => {
      if (!s.biggestClimb || s.biggestClimb.elevation < 100) return null;
      return bigNumberCard({
        tagKey: 'wrapped.climb.tag',
        number: Math.round(s.biggestClimb.elevation), unit: 'm D+',
        caption: (
          <>
            <div style={{ fontFamily: "'Playfair Display'", fontStyle: 'italic', fontSize: isMobile ? 18 : 24, color: tokens.ink, marginBottom: 4 }}>
              {s.biggestClimb.title}
            </div>
            <div style={{ fontSize: 12, color: tokens.inkLight, letterSpacing: '0.05em' }}>
              {formatDateLocale(s.biggestClimb.rawDate, lang, { day: '2-digit', month: 'long', year: 'numeric' })}
              {' · '}{Math.round(s.biggestClimb.distance)} km
            </div>
          </>
        ),
        fg: tokens.ink, accent: tokens.blue, isMobile, t,
      });
    },
  },

  // 6 — Top sport
  // Hidden when the data only contains one sport — e.g. the page was
  // filtered to cycling at the call site, so showing "top sport: Vélo"
  // would just restate what the user already knows. Stays useful in
  // any future call site that passes mixed-sport data.
  {
    key: 'topSport',
    bg: `linear-gradient(135deg, ${tokens.blue} 0%, ${tokens.creamDark} 100%)`,
    accent: '#fff', fg: '#fff',
    render: (s, t, _l, isMobile) => {
      if (!s.topSport || s.distinctSports < 2) return null;
      const labelKey = SPORT_NAME_KEY[s.topSport.id] ?? 'common.cycling';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
          <span style={{
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.18em', textTransform: 'uppercase', color: '#fff', opacity: 0.9,
          }}>{t('wrapped.topSport.tag')}</span>
          <div style={{
            fontFamily: "'Playfair Display'",
            fontSize: isMobile ? 64 : 110, fontWeight: 900,
            color: '#fff', lineHeight: 0.95,
          }}>{t(labelKey)}</div>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: isMobile ? 14 : 18, color: '#fff', opacity: 0.9 }}>
            {t('wrapped.topSport.caption')
              .replace('{count}', String(s.topSport.count))
              .replace('{km}', s.topSport.distance.toLocaleString())}
          </div>
        </div>
      );
    },
  },

  // 7 — Best month (chart)
  {
    key: 'bestMonth',
    bg: `linear-gradient(160deg, ${tokens.cream} 0%, ${tokens.creamDark} 100%)`,
    accent: tokens.terra, fg: tokens.ink,
    render: (s, t, _l, isMobile) => {
      if (!s.bestMonth) return null;
      const max = Math.max(...s.monthlyDist, 1);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%', maxWidth: 720 }}>
          <span style={{
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.18em', textTransform: 'uppercase', color: tokens.terra,
          }}>{t('wrapped.bestMonth.tag')}</span>
          <div style={{
            fontFamily: "'Playfair Display'",
            fontSize: isMobile ? 64 : 110, fontWeight: 900,
            color: tokens.ink, lineHeight: 0.95, textTransform: 'capitalize',
          }}>{t(`wrapped.month.${MONTH_KEYS[s.bestMonth.idx]}`)}</div>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: isMobile ? 14 : 16, color: tokens.inkMid }}>
            {t('wrapped.bestMonth.caption').replace('{km}', s.bestMonth.distance.toLocaleString())}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 90, marginTop: 8 }}>
            {s.monthlyDist.map((v, i) => {
              const h = (v / max) * 100;
              const active = i === s.bestMonth!.idx;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: '100%', height: `${h}%`, minHeight: v ? 3 : 0,
                    background: active ? tokens.terra : tokens.inkLight,
                    opacity: active ? 1 : 0.35, borderRadius: '2px 2px 0 0',
                    transition: 'height 0.8s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {t(`wrapped.month.${MONTH_KEYS[i]}`).slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    },
  },

  // 8 — Outro
  {
    key: 'outro',
    bg: `linear-gradient(135deg, ${tokens.terra} 0%, ${tokens.green} 100%)`,
    accent: '#fff', fg: '#fff',
    render: (s, t, _l, isMobile) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
        <span style={{
          fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
          letterSpacing: '0.2em', textTransform: 'uppercase', color: '#fff', opacity: 0.9,
        }}>{t('wrapped.outro.tag')}</span>
        <div style={{
          fontFamily: "'Playfair Display'", fontStyle: 'italic',
          fontSize: isMobile ? 36 : 64, fontWeight: 900,
          color: '#fff', lineHeight: 1.05,
        }}>{t('wrapped.outro.title')}</div>
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: isMobile ? 14 : 18, color: '#fff', opacity: 0.95, lineHeight: 1.5 }}>
          {t('wrapped.outro.caption')
            .replace('{km}', s.distance.toLocaleString())
            .replace('{m}',  s.elevation.toLocaleString())
            .replace('{h}',  String(s.hours))
            .replace('{n}',  String(s.count))}
        </div>
      </div>
    ),
  },
];

// ── Component ────────────────────────────────────────────────────────────────

const AUTO_ADVANCE_MS = 5500;

export function WrappedPage({ activities }: Props) {
  const { t, lang } = useT();
  const isMobile = useIsMobile();

  // Years that have at least one activity, newest first.
  const availableYears = useMemo(() => {
    const set = new Set<number>();
    for (const a of activities) set.add(new Date(a.rawDate).getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [activities]);

  const [year, setYear]         = useState<number | null>(null);
  const [cardIdx, setCardIdx]   = useState(0);
  const [paused, setPaused]     = useState(false);

  // Default to the most recent year that has data.
  useEffect(() => {
    if (year == null && availableYears.length > 0) setYear(availableYears[0]);
  }, [availableYears, year]);

  const yearStats = useMemo(() => {
    if (year == null) return null;
    return computeYear(activities, year);
  }, [activities, year]);

  // Filter cards whose render returns null (e.g. no biggestClimb on running-only year).
  const visibleCards = useMemo(() => {
    if (!yearStats) return [];
    return CARDS.filter(c => c.render(yearStats, t, lang, isMobile) != null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearStats, lang, isMobile]);

  // Reset to first card whenever the year changes.
  useEffect(() => { setCardIdx(0); }, [year]);

  const next = useCallback(() => {
    setCardIdx(i => (visibleCards.length === 0 ? 0 : (i + 1) % visibleCards.length));
  }, [visibleCards.length]);
  const prev = useCallback(() => {
    setCardIdx(i => (visibleCards.length === 0 ? 0 : (i - 1 + visibleCards.length) % visibleCards.length));
  }, [visibleCards.length]);

  // Auto-advance unless paused.
  useEffect(() => {
    if (paused || visibleCards.length === 0) return;
    const id = setTimeout(next, AUTO_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [cardIdx, paused, visibleCards.length, next]);

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft')              { e.preventDefault(); prev(); }
      else if (e.key === 'Escape')                 { setPaused(p => !p); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev]);

  if (availableYears.length === 0 || !yearStats) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight }}>{t('wrapped.empty')}</p>
      </div>
    );
  }

  const card = visibleCards[Math.min(cardIdx, visibleCards.length - 1)];

  const containerStyle: CSSProperties = {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: card.bg, transition: 'background 0.6s ease',
    position: 'relative', overflow: 'hidden',
  };

  return (
    <div style={containerStyle}>
      {/* Top: progress bars + year selector */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
        padding: isMobile ? '14px 16px 0' : '18px 32px 0',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {visibleCards.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 2, borderRadius: 1,
              background: 'rgba(255,255,255,0.25)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: i < cardIdx ? '100%' : i === cardIdx ? '100%' : '0%',
                background: card.fg === '#fff' ? '#fff' : tokens.ink, opacity: 0.95,
                transition: i === cardIdx && !paused ? `width ${AUTO_ADVANCE_MS}ms linear` : 'width 0.2s',
              }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {availableYears.map(y => {
            const active = y === year;
            const onLight = card.fg !== '#fff';
            return (
              <button key={y} onClick={(e) => { e.stopPropagation(); setYear(y); }} style={{
                fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: active ? 700 : 500,
                letterSpacing: '0.1em',
                padding: '4px 10px', border: 'none', borderRadius: 12, cursor: 'pointer',
                background: active
                  ? (onLight ? tokens.ink : '#fff')
                  : (onLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.18)'),
                color: active
                  ? (onLight ? '#fff' : tokens.ink)
                  : (onLight ? tokens.inkMid : '#fff'),
                transition: 'all 0.15s',
              }}>{y}</button>
            );
          })}
          <button onClick={(e) => { e.stopPropagation(); setPaused(p => !p); }} style={{
            marginLeft: 'auto',
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 500,
            letterSpacing: '0.1em',
            padding: '4px 10px', border: 'none', borderRadius: 12, cursor: 'pointer',
            background: card.fg === '#fff' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)',
            color: card.fg === '#fff' ? '#fff' : tokens.inkMid,
          }}>{paused ? t('wrapped.play') : t('wrapped.pause')}</button>
        </div>
      </div>

      {/* Card body — click anywhere to advance, click left edge to go back. */}
      <div
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          if (e.clientX - rect.left < rect.width * 0.25) prev();
          else next();
        }}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: isMobile ? '90px 24px 60px' : '120px 60px 80px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ width: '100%', maxWidth: 760 }} key={card.key /* re-mount on card change to re-trigger transitions */}>
          {card.render(yearStats, t, lang, isMobile)}
        </div>
      </div>

      {/* Footer hint */}
      <div style={{
        position: 'absolute', bottom: 16, left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none',
        fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.15em',
        textTransform: 'uppercase', opacity: 0.6,
        color: card.fg === '#fff' ? '#fff' : tokens.inkLight,
      }}>
        {isMobile ? t('wrapped.hint.tap') : t('wrapped.hint.click')}
      </div>
    </div>
  );
}
