'use client';

/**
 * Training Load page — the CTL / ATL / TSB curves cycling coaches use
 * to time form peaks. CTL ("fitness") and ATL ("fatigue") are
 * exponentially-weighted moving averages of daily TSS over 42 and 7
 * days respectively; TSB = CTL − ATL = "form today".
 *
 * Strava hides this behind Premium. We give it gratos.
 *
 * Reading the curves:
 *   ↗ CTL rising  = you're getting fitter
 *   ↑ ATL spike   = a hard week, expect to feel tired
 *   ↘ TSB dip     = fatigue accumulating, schedule recovery
 *   ↑ TSB peak    = race-ready, time for goal day
 */

import { useMemo } from 'react';
import {
  LineChart, Line, Area, ComposedChart, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Legend,
} from 'recharts';
import { tokens, Activity } from '../tokens';
import { Label, useIsMobile } from '../ui';
import { computeTrainingLoad, tsbZoneFor, TrainingLoadPoint } from '@/lib/training-load';

export function TrainingLoadPage({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();

  // Only cycling activities count for TSS — running/walking/etc. don't
  // produce comparable TSS numbers in our model.
  const cyclingActivities = useMemo(
    () => activities.filter(a => a.type === 'cycling' && a.tss),
    [activities],
  );

  const series = useMemo(() => computeTrainingLoad(cyclingActivities), [cyclingActivities]);

  // The default view is the last 90 days — long enough to see CTL
  // trends, short enough that the chart doesn't crush detail.
  const last90 = useMemo(() => series.slice(-90), [series]);
  const today  = last90[last90.length - 1];
  const zone   = today ? tsbZoneFor(today.tsb) : null;

  if (cyclingActivities.length < 5) {
    return (
      // The parent ExplorerApp main is `overflow: hidden` — each page
      // must provide its own scroll container with `flex:1 + overflowY:
      // auto`. Same pattern as FtpPage / WrappedPage.
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '40px 24px', background: tokens.cream }}>
        <div style={{ maxWidth: 720, margin: '0 auto', background: tokens.surface,
                      border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 36 }}>
          <SectionHeader />
          <p style={{ marginTop: 18, color: tokens.inkLight, fontFamily: "'Space Grotesk'", fontSize: 13, lineHeight: 1.6 }}>
            Pas assez d&apos;activités cyclisme avec TSS pour calculer ta charge. Reviens après quelques sorties.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '40px 24px', background: tokens.cream }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <SectionHeader />

        {today && zone && <TodayTile point={today} zone={zone} />}

        {/* CTL + ATL stacked area chart */}
        <Card>
          <Label style={{ display: 'block', marginBottom: 12, color: tokens.inkLight }}>
            FORME (CTL) vs FATIGUE (ATL) — 90 JOURS
          </Label>
          <ResponsiveContainer width="100%" height={isMobile ? 220 : 280}>
            <ComposedChart data={last90} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} vertical={false} />
              <XAxis dataKey="date" tick={{ fontFamily: "'Space Grotesk'", fontSize: 9, fill: tokens.inkLight }}
                tickFormatter={d => (d as string).slice(5)} interval={Math.floor(last90.length / 8)} />
              <YAxis tick={{ fontFamily: "'Space Grotesk'", fontSize: 9, fill: tokens.inkLight }} width={32} />
              <Tooltip contentStyle={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, fontSize: 11 }}
                labelStyle={{ color: tokens.ink }} />
              <Legend wrapperStyle={{ fontFamily: "'Space Grotesk'", fontSize: 11 }} />
              <Area type="monotone" dataKey="ctl" stroke={tokens.green}  fill={tokens.green}  fillOpacity={0.18} name="CTL (forme)" />
              <Line type="monotone" dataKey="atl" stroke={tokens.terra}  strokeWidth={2}      name="ATL (fatigue)" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        {/* TSB chart with zones */}
        <Card>
          <Label style={{ display: 'block', marginBottom: 12, color: tokens.inkLight }}>
            FORME DU JOUR (TSB = CTL − ATL)
          </Label>
          <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
            <LineChart data={last90} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} vertical={false} />
              {/* Zone bands — overreach below, fatigue, optimal, racing, too fresh */}
              <ReferenceArea y1={-100} y2={-30} fill="#A23838" fillOpacity={0.08} />
              <ReferenceArea y1={-30}  y2={-10} fill={tokens.terra} fillOpacity={0.08} />
              <ReferenceArea y1={-10}  y2={5}   fill="#9CCC65" fillOpacity={0.12} />
              <ReferenceArea y1={5}    y2={25}  fill={tokens.green} fillOpacity={0.12} />
              <ReferenceArea y1={25}   y2={100} fill={tokens.blue}  fillOpacity={0.06} />
              <ReferenceLine y={0} stroke={tokens.inkLight} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontFamily: "'Space Grotesk'", fontSize: 9, fill: tokens.inkLight }}
                tickFormatter={d => (d as string).slice(5)} interval={Math.floor(last90.length / 8)} />
              <YAxis tick={{ fontFamily: "'Space Grotesk'", fontSize: 9, fill: tokens.inkLight }} width={32}
                domain={[-50, 50]} />
              <Tooltip contentStyle={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, fontSize: 11 }} />
              <Line type="monotone" dataKey="tsb" stroke={tokens.ink} strokeWidth={2.5} dot={false} name="TSB" />
            </LineChart>
          </ResponsiveContainer>
          <ZoneLegend />
        </Card>

        <ExplainerCard />
      </div>
    </div>
  );
}

function SectionHeader() {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 6px' }}>
        § CHARGE D&apos;ENTRAÎNEMENT
      </p>
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 32, fontWeight: 800, color: tokens.ink, margin: 0, lineHeight: 1.15 }}>
        Forme, fatigue, <em style={{ fontStyle: 'italic', fontWeight: 700, color: tokens.terra }}>équilibre</em>.
      </h1>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.55, marginTop: 8, maxWidth: 720 }}>
        Les trois courbes que les coachs cyclistes pros utilisent pour timer leurs pics de forme.
        CTL = ta forme à long terme (42 jours), ATL = ta fatigue récente (7 jours), TSB = CTL − ATL = ta forme du jour.
      </p>
    </div>
  );
}

function TodayTile({ point, zone }: { point: TrainingLoadPoint; zone: ReturnType<typeof tsbZoneFor> }) {
  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
                  borderLeft: `4px solid ${zone.color}`, borderRadius: 4, padding: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <Stat label="CTL — FORME"   value={point.ctl.toFixed(1)} color={tokens.green} />
        <Stat label="ATL — FATIGUE" value={point.atl.toFixed(1)} color={tokens.terra} />
        <Stat label="TSB — FORME DU JOUR" value={(point.tsb > 0 ? '+' : '') + point.tsb.toFixed(1)} color={zone.color} big />
      </div>
      <p style={{ marginTop: 16, fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: zone.color }}>
        {zone.label}
      </p>
      <p style={{ marginTop: 4, fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, lineHeight: 1.5 }}>
        {zone.description}
      </p>
    </div>
  );
}

function Stat({ label, value, color, big = false }: { label: string; value: string; color: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                    color: tokens.inkLight, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Playfair Display'", fontSize: big ? 36 : 22, fontWeight: 800, color, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 20, marginBottom: 24 }}>
      {children}
    </div>
  );
}

function ZoneLegend() {
  const zones = [
    { range: 'TSB > +25',   label: 'Trop frais',      color: tokens.blue },
    { range: '+5..+25',     label: 'Race-ready',      color: tokens.green },
    { range: '-10..+5',     label: 'Optimal',         color: '#9CCC65' },
    { range: '-30..-10',    label: 'Fatigue',         color: tokens.terra },
    { range: '< -30',       label: 'Surcharge',       color: '#A23838' },
  ];
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12,
                  fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkMid }}>
      {zones.map(z => (
        <div key={z.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, background: z.color, borderRadius: 2, opacity: 0.6 }} />
          <span><strong style={{ color: tokens.ink }}>{z.label}</strong> · {z.range}</span>
        </div>
      ))}
    </div>
  );
}

function ExplainerCard() {
  return (
    <div style={{ background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 18,
                  fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, lineHeight: 1.7 }}>
      <strong style={{ color: tokens.ink, fontFamily: "'Playfair Display'", fontSize: 14, display: 'block', marginBottom: 8 }}>
        Comment lire ces courbes
      </strong>
      <p style={{ margin: '0 0 8px' }}>
        <strong style={{ color: tokens.green }}>CTL</strong> (Chronic Training Load) monte quand tu t&apos;entraînes régulièrement —
        c&apos;est ta forme. Plus elle est haute, plus ton corps encaisse.
      </p>
      <p style={{ margin: '0 0 8px' }}>
        <strong style={{ color: tokens.terra }}>ATL</strong> (Acute Training Load) réagit vite — un gros week-end de stage la fait piquer.
        Ta fatigue à court terme.
      </p>
      <p style={{ margin: '0 0 8px' }}>
        <strong style={{ color: tokens.ink }}>TSB</strong> = CTL − ATL = ta forme du jour. Positif = frais, négatif = fatigué.
        Les coachs cherchent à pic à TSB ≈ +10/+15 le jour d&apos;un objectif majeur.
      </p>
      <p style={{ margin: 0, fontStyle: 'italic', color: tokens.inkLight }}>
        Formule (Coggan) : <code>CTL(t) = CTL(t−1) + (TSS(t) − CTL(t−1)) / 42</code> et idem ATL avec 7.
      </p>
    </div>
  );
}
