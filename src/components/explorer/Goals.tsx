'use client';

import { useEffect, useState } from 'react';
import { Activity, tokens } from './tokens';
import { Label } from './ui';
import { useT } from '@/i18n';

interface GoalSet {
  km:   number;
  elev: number;
  tss:  number;
  activities: number;
}

const DEFAULTS: GoalSet = { km: 100, elev: 1000, tss: 300, activities: 4 };

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const dow = (out.getDay() + 6) % 7; // 0 = Mon
  out.setDate(out.getDate() - dow);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function Goals({ activities }: { activities: Activity[] }) {
  const { t } = useT();
  const [goals, setGoals] = useState<GoalSet>(DEFAULTS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GoalSet>(DEFAULTS);

  useEffect(() => {
    const saved = localStorage.getItem('tle_goals');
    if (saved) {
      try {
        const g = JSON.parse(saved) as GoalSet;
        setGoals(g);
        setDraft(g);
      } catch { /* ignore */ }
    }
  }, []);

  // Aggregate this week's totals.
  const weekStart = startOfWeek(new Date());
  const weekRides = activities.filter(a => new Date(a.rawDate).getTime() >= weekStart.getTime());
  const totals = {
    km:   Math.round(weekRides.reduce((s, a) => s + a.distance, 0)),
    elev: Math.round(weekRides.reduce((s, a) => s + a.elevation, 0)),
    tss:  Math.round(weekRides.reduce((s, a) => s + (a.tss ?? 0), 0)),
    activities: weekRides.length,
  };

  const save = () => {
    setGoals(draft);
    localStorage.setItem('tle_goals', JSON.stringify(draft));
    setEditing(false);
  };
  const cancel = () => {
    setDraft(goals);
    setEditing(false);
  };

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 16,
  };

  const items: { key: keyof GoalSet; label: string; unit: string; color: string }[] = [
    { key: 'km',         label: t('goals.km'),         unit: 'km', color: tokens.terra },
    { key: 'elev',       label: t('goals.elev'),       unit: 'm',  color: tokens.green },
    { key: 'tss',        label: t('goals.tss'),        unit: '',   color: tokens.blue  },
    { key: 'activities', label: t('goals.activities'), unit: '',   color: tokens.inkMid },
  ];

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Label style={{ color: tokens.terra }}>{t('goals.tag')}</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>{t('goals.label')}</Label>
        </div>
        {!editing ? (
          <button onClick={() => setEditing(true)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight,
            letterSpacing: '0.1em', textDecoration: 'underline',
          }}>{t('goals.edit')}</button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancel} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight,
              textDecoration: 'underline',
            }}>{t('goals.cancel')}</button>
            <button onClick={save} style={{
              background: tokens.terra, color: 'white', border: 'none',
              padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            }}>{t('goals.save')}</button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {items.map(it => {
          const cur = totals[it.key];
          const tgt = goals[it.key];
          const pct = Math.min(100, tgt > 0 ? (cur / tgt) * 100 : 0);
          const reached = cur >= tgt;
          return (
            <div key={it.key}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <Label>{it.label}</Label>
                {editing ? (
                  <input type="number" value={draft[it.key]}
                    onChange={e => setDraft({ ...draft, [it.key]: +e.target.value })}
                    style={{
                      width: 72, padding: '2px 6px', textAlign: 'right',
                      border: `1px solid ${tokens.creamBorder}`, borderRadius: 2,
                      fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.ink,
                      background: tokens.creamDark,
                    }} />
                ) : (
                  <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
                    {cur} / {tgt}{it.unit && ' ' + it.unit}
                  </span>
                )}
              </div>
              <div style={{
                width: '100%', height: 8, background: tokens.creamDark, borderRadius: 4, overflow: 'hidden',
                border: `1px solid ${tokens.creamBorder}`,
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: it.color,
                  transition: 'width 0.3s', boxShadow: reached ? `0 0 4px ${it.color}` : 'none',
                }} />
              </div>
              {reached && !editing && (
                <div style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: it.color, marginTop: 2, fontWeight: 700 }}>
                  {t('goals.reached')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
