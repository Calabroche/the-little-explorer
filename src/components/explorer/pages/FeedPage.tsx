'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { tokens, Activity, GlobalStats } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { ActivityCard } from '../ActivityCard';
import { ActivityCalendar } from '../ActivityCalendar';
import { Goals } from '../Goals';
import { PersonalRecords } from '../PersonalRecords';
import { RunPaceZones } from '../RunPaceZones';
import { RaceProjector } from '../RaceProjector';
import type { SportId } from '../Sidebar';
import { useT } from '@/i18n';

// ── Empty state ───────────────────────────────────────────────────────────────
// Rendered when the user has 0 activities. Two paths:
//   - Strava not linked yet (athleteId === null) → big invite to connect,
//     with the quota-limit disclaimer so they understand it might block.
//   - Strava linked but feed empty (athleteId set) → "your sync is fresh,
//     try Re-syncer Strava or wait for the next cron pass."
//
// Both paths bypass the rest of the feed UI (charts, widgets, goals…)
// which all look broken on an empty data set.
/**
 * Maps `?error=strava_*` codes that come back from
 * /api/connect/strava/callback into a French explanation.
 * `?strava=connected` instead surfaces a green success banner.
 * Returns null when there's nothing to surface (the common case).
 */
function useConnectStravaBanner(): { tone: 'ok' | 'err'; text: string } | null {
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // Same JWT-cache problem as /onboarding: /api/connect/strava/callback
  // wrote athleteId to next_auth.users, but our session cookie still
  // has athleteId=null until we hit /api/auth/session. update() does
  // exactly that. Without this, the sidebar's "+ Connecter Strava"
  // button stays visible AND the middleware-side gating reads the
  // stale token. Triggering it once on detect ?strava=connected
  // closes the gap.
  const { update: refreshSession } = useSession();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ok  = params.get('strava');
    const err = params.get('error');
    if (ok === 'connected') {
      setBanner({ tone: 'ok', text: 'Strava connecté — récupération de tes sorties en cours…' });
      // Auto-kick the full sync pipeline (activity summaries +
      // streams backfill) for a freshly-linked athlete so they
      // never have to find + click two manual buttons. Fires the
      // /sync once + then loops /backfill-streams until done.
      // Reloads on success so the home page comes back with a
      // populated feed.
      void (async () => {
        try {
          // Refresh the JWT cookie first so the rest of the page
          // (and the next navigation) sees the new athleteId.
          await refreshSession();
          const r = await fetch('/api/strava/sync', { method: 'POST' });
          if (!r.ok) return;  // ResyncErrorBanner via the sidebar will surface this on next click
          // Loop backfill until done, ignoring failures silently
          // (the rider has cards by now; streams missing surfaces
          // via the dedicated button if needed).
          for (let i = 0; i < 50; i++) {
            const rr = await fetch('/api/strava/backfill-streams', { method: 'POST' });
            if (!rr.ok) break;
            const d = await rr.json() as { done?: boolean; processed?: number; remaining?: number };
            if (d.done || (d.processed === 0 && d.remaining === 0)) break;
          }
          // Reload to surface the now-populated activity list +
          // chart-ready data.
          window.location.reload();
        } catch { /* silent — manual buttons still work */ }
      })();
    } else if (err?.startsWith('strava_')) {
      const reasons: Record<string, string> = {
        strava_no_session:        "Ta session a expiré pendant la connexion. Recharge la page et réessaie.",
        strava_denied:            "Tu as refusé l'autorisation côté Strava. Reclique \"Connecter Strava\" si c'était par accident.",
        strava_no_code:           "Strava n'a pas renvoyé de code d'autorisation. Réessaie.",
        strava_no_state_cookie:   "Le cookie de sécurité a expiré (10 min). Reclique \"Connecter Strava\".",
        strava_bad_cookie:        "Cookie de sécurité corrompu. Reclique \"Connecter Strava\".",
        strava_state_mismatch:    "Le code de sécurité ne matche pas. Reclique \"Connecter Strava\".",
        strava_state_expired:     "La demande a expiré. Reclique \"Connecter Strava\".",
        strava_misconfigured:     "L'app a un souci de config Strava — écris à Florian.",
        strava_token_exchange:    "Strava a refusé d'échanger ton code. Si ça persiste, écris à Florian.",
        strava_no_athlete:        "Strava n'a pas renvoyé d'identifiant d'athlète. Très inhabituel — écris à Florian.",
        strava_persist_user:      "Connexion OK mais on n'a pas pu sauver ton profil. Recharge et réessaie.",
        strava_persist_account:   "Connexion OK mais on n'a pas pu sauver tes credentials. Recharge et réessaie.",
      };
      setBanner({ tone: 'err', text: reasons[err] ?? 'Connexion Strava échouée — réessaie.' });
    }
    // Clean the URL so a refresh doesn't keep showing the banner.
    if (ok || err?.startsWith('strava_')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('strava');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);
  return banner;
}

function EmptyFeedState({ athleteId, displayName }: { athleteId: number | null; displayName: string }) {
  const isMobile = useIsMobile();
  const banner   = useConnectStravaBanner();
  return (
    <div style={{
      maxWidth: 720,
      margin: '40px auto',
      padding: isMobile ? '28px 22px' : '40px',
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
      textAlign: 'left',
    }}>
      <SectionTag num={1} title="BIENVENUE" />
      <h2 style={{
        fontFamily: "'Playfair Display'",
        fontSize: isMobile ? 26 : 34,
        fontWeight: 800,
        color: tokens.ink,
        lineHeight: 1.15,
        margin: '8px 0 14px',
      }}>
        Salut {displayName} !<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>
          {athleteId ? 'Synchronisation en cours…' : 'Ton compte est créé.'}
        </em>
      </h2>

      {banner && (
        <div style={{
          padding:      '10px 12px',
          marginBottom: 16,
          background:   banner.tone === 'ok' ? '#EFF7EE' : '#FEE',
          border:       `1px solid ${banner.tone === 'ok' ? '#CDE5C9' : '#FCC'}`,
          color:        banner.tone === 'ok' ? '#2E5C2A' : '#A00',
          borderRadius: 4,
          fontFamily:   "'Space Grotesk'",
          fontSize:     12,
          lineHeight:   1.55,
        }}>
          {banner.text}
        </div>
      )}

      {athleteId == null ? (
        <>
          <p style={{ fontFamily: "'Space Grotesk'", fontSize: 14, color: tokens.inkMid, lineHeight: 1.6, marginBottom: 16 }}>
            Pour voir tes sorties, calendrier d&apos;activités, records personnels
            et objectifs, il faut lier ton compte Strava à ton profil.
          </p>

          {/* Quota disclaimer removed — Strava granted the 10-athlete
              tier (2026-06). Re-add a banner here if we approach the
              cap or Strava ever revokes it. */}

          <button
            // Custom link-account endpoint, NOT NextAuth's signIn —
            // signIn('strava') would try to create a brand-new user
            // because Strava's synthetic email doesn't match the
            // user's Google email. /api/connect/strava/start
            // attaches Strava to the *existing* signed-in user.
            onClick={() => { window.location.href = '/api/connect/strava/start'; }}
            style={{
              padding: '12px 22px',
              background: '#FC4C02',
              border: '1px solid #FC4C02',
              borderRadius: 4,
              color: '#fff',
              fontFamily: "'Space Grotesk'",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            + CONNECTER STRAVA
          </button>
        </>
      ) : (
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 14, color: tokens.inkMid, lineHeight: 1.6 }}>
          Ton Strava est lié mais on n&apos;a pas encore récupéré tes
          sorties. Si rien n&apos;apparaît dans 1-2 minutes, clique
          <strong> ↻ RE-SYNCER STRAVA </strong>
          dans la sidebar (bloc Profil en bas à gauche) — ça force la
          synchronisation immédiate.
        </p>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TssChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: '8px 10px',
      fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.ink,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.dateFull}</div>
      <div style={{ color: tokens.terra }}>TSS : <strong>{p.tss}</strong></div>
      {p.power != null && (
        <div style={{ color: tokens.green }}>Puissance : <strong>{p.power} W</strong></div>
      )}
      <div style={{ color: tokens.inkLight, marginTop: 2 }}>{p.distance} km · {p.elev} m D+</div>
    </div>
  );
}

// ── Training Program ──────────────────────────────────────────────────────────

function daysBetween(a: string, b: string) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function formatPredictedDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Exported so the "Puissance & Charge" page (FtpPage) can render it — the
// power-records + training-program blocks now live there, not on the feed.
export function TrainingProgram({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  const { t } = useT();

  // Memoised — was 6+ reduce()s, 2 sorts and a chartData rebuild on
  // every render of this component (which is mounted on the feed
  // page, the most-visited surface). Now recomputes only when
  // activities actually change.
  const stats = useMemo(() => {
    const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
    const last5  = sorted.slice(0, 5);
    const last10 = sorted.slice(0, 10);

    const gaps: number[] = [];
    for (let i = 0; i < last5.length - 1; i++)
      gaps.push(daysBetween(last5[i].rawDate, last5[i + 1].rawDate));
    const avgGap = gaps.length ? Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length) : 0;

    const tssValues10 = last10.map(a => a.tss).filter((t): t is number => t != null);
    const avgTSS10    = tssValues10.length ? Math.round(tssValues10.reduce((s, v) => s + v, 0) / tssValues10.length) : null;

    const tssValuesAll = activities.map(a => a.tss).filter((t): t is number => t != null);
    const avgTSSAll    = tssValuesAll.length ? Math.round(tssValuesAll.reduce((s, v) => s + v, 0) / tssValuesAll.length) : null;
    const powerValuesAll = activities.map(a => a.avg_power).filter((p): p is number => p != null);
    const avgPowerAll    = powerValuesAll.length ? Math.round(powerValuesAll.reduce((s, v) => s + v, 0) / powerValuesAll.length) : null;

    const chartData = last10.slice().reverse().map(a => {
      const d = new Date(a.rawDate);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return {
        date:     `${dd}/${mm}`,
        dateFull: d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }),
        tss:      a.tss ?? 0,
        power:    a.avg_power ?? null,
        distance: a.distance,
        elev:     a.elevation,
      };
    });

    const tssValues5 = last5.map(a => a.tss).filter((t): t is number => t != null);
    const avgTSS5    = tssValues5.length ? Math.round(tssValues5.reduce((s, v) => s + v, 0) / tssValues5.length) : null;
    const lastTSS    = tssValues5[0] ?? null;
    const targetTSS  = avgTSS5 ? Math.round(avgTSS5 * 1.1) : null;

    const avgDist = last5.length ? Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length) : 0;
    const avgElev = last5.length ? Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length) : 0;

    return {
      last5, last10, avgGap,
      avgTSS10, avgTSSAll, avgPowerAll,
      chartData, avgTSS5, lastTSS, targetTSS,
      avgDist, avgElev,
    };
  }, [activities]);

  if (stats.last5.length < 2) return null;

  // Destructure for downstream JSX — keeps the diff minimal vs the
  // pre-memo version.
  const { last5, last10, avgGap, avgTSS10, avgTSSAll, avgPowerAll,
          chartData, avgTSS5, lastTSS, targetTSS, avgDist, avgElev } = stats;

  const nextDate = new Date(last5[0].rawDate);
  nextDate.setDate(nextDate.getDate() + avgGap);
  const daysUntil = daysBetween(nextDate.toISOString(), new Date().toISOString());

  let advice = t('program.adviceDefault');
  if (lastTSS && avgTSS5) {
    if (lastTSS > avgTSS5 * 1.3)      advice = t('program.adviceIntense');
    else if (lastTSS < avgTSS5 * 0.7) advice = t('program.adviceLight');
    else if (avgTSS5 > 80)            advice = t('program.adviceHigh');
  }

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  const NEXT_RIDE_STAT: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 1,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.terra }}>{t('program.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('program.label')}</Label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: isMobile ? 20 : 28 }}>

        {/* Col 1 : TSS chart (10 sorties) + next ride compact dessous */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <Label>{t('program.chartLabel')}</Label>
            <div style={{ display: 'flex', gap: 12, fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: tokens.terra, marginRight: 4, verticalAlign: 'middle' }} />{t('program.chartLegendTss')}</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 2, background: tokens.green, marginRight: 4, verticalAlign: 'middle' }} />{t('program.chartLegendPower')}</span>
            </div>
          </div>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                  tickLine={false}
                  axisLine={{ stroke: tokens.creamBorder }}
                />
                <YAxis
                  yAxisId="tss"
                  orientation="left"
                  width={32}
                  tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="pow"
                  orientation="right"
                  width={36}
                  tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `${v}W`}
                />
                <Tooltip content={<TssChartTooltip />} cursor={{ fill: tokens.creamBorder, opacity: 0.4 }} />
                {avgTSSAll != null && (
                  <ReferenceLine
                    yAxisId="tss"
                    y={avgTSSAll}
                    stroke={tokens.terra}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{ value: `moy. ${avgTSSAll}`, position: 'insideTopLeft', fill: tokens.terra, fontFamily: "'Space Grotesk'", fontSize: 9 }}
                  />
                )}
                {avgPowerAll != null && (
                  <ReferenceLine
                    yAxisId="pow"
                    y={avgPowerAll}
                    stroke={tokens.green}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{ value: `moy. ${avgPowerAll}W`, position: 'insideBottomRight', fill: tokens.green, fontFamily: "'Space Grotesk'", fontSize: 9 }}
                  />
                )}
                <Bar
                  yAxisId="tss"
                  dataKey="tss"
                  name="TSS"
                  fill={tokens.terra}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
                <Line
                  yAxisId="pow"
                  type="monotone"
                  dataKey="power"
                  name="Puissance moy."
                  stroke={tokens.green}
                  strokeWidth={2}
                  dot={{ r: 3, fill: tokens.green, strokeWidth: 0 }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 24 }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>{t('program.avgInterval')}</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgGap}j
              </span>
            </div>
            {avgTSS10 && (
              <div>
                <Label style={{ display: 'block', marginBottom: 3 }}>{t('program.avgTss10')}</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                  {avgTSS10}
                </span>
              </div>
            )}
          </div>

          {/* Prochaine sortie — compact, sous le graphique */}
          <div style={{
            marginTop: 18, paddingTop: 14, borderTop: `1px solid ${tokens.creamBorder}`,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 2 }}>{t('program.nextRide')}</Label>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.terra, lineHeight: 1.2 }}>
                {formatPredictedDate(nextDate.toISOString())}
              </div>
              <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginTop: 1 }}>
                {daysUntil > 0
                  ? t('program.avgIn', { n: daysUntil, s: daysUntil > 1 ? 's' : '' })
                  : daysUntil === 0 ? t('common.onIt')
                  : t('program.avgPast', { n: Math.abs(daysUntil) })}
              </div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: tokens.creamBorder }} />
            <div style={NEXT_RIDE_STAT}>
              <Label>{t('program.nextDist')}</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.ink }}>
                {avgDist}<span style={{ fontSize: 9, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 2 }}>km</span>
              </span>
            </div>
            <div style={NEXT_RIDE_STAT}>
              <Label>{t('program.nextElev')}</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.ink }}>
                {avgElev}<span style={{ fontSize: 9, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 2 }}>m</span>
              </span>
            </div>
            {targetTSS && (
              <div style={NEXT_RIDE_STAT}>
                <Label>{t('program.nextTssTarget')}</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.terra }}>
                  {targetTSS}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Col 2 : Recommandation + Règle 10% + TSS explainer */}
        <div style={{
          borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`,
          paddingLeft: isMobile ? 0 : 24,
          borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none',
          paddingTop: isMobile ? 20 : 0,
        }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>{t('program.recommendation')}</Label>
          <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.7, marginBottom: 14 }}>
            {advice}
          </p>
          <div style={{ padding: '10px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8, marginBottom: 12 }}>
            <strong style={{ color: tokens.ink }}>{t('program.ruleTitle')}</strong><br />
            {t('program.ruleBody')}
          </div>
          <div style={{ padding: '10px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8 }}>
            <strong style={{ color: tokens.terra }}>{t('program.tssTitle')}</strong><br />
            {t('program.tssExplain1')}<br />
            <code style={{ color: tokens.ink }}>{t('program.tssFormula')}</code><br />
            <strong style={{ color: tokens.ink }}>{t('program.tssFtpLine', { ftp: last5[0]?.ftp ?? 291 })}</strong><br />
            {t('program.tssScale')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Last 5 averages ───────────────────────────────────────────────────────────

function avg(vals: (number | null | undefined)[]): number | null {
  const clean = vals.filter((v): v is number => v != null);
  return clean.length ? +(clean.reduce((s, v) => s + v, 0) / clean.length).toFixed(1) : null;
}

function avgInt(vals: (number | null | undefined)[]): number | null {
  const v = avg(vals);
  return v != null ? Math.round(v) : null;
}

function formatAvgDuration(activities: Activity[]): string | null {
  const mins = activities.map(a => a.duration_min).filter((v): v is number => v != null);
  if (!mins.length) return null;
  const m = Math.round(mins.reduce((s, v) => s + v, 0) / mins.length);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Stat({ label, value, unit, color }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 80 }}>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.08em', color: tokens.inkLight, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 700, color: color ?? tokens.ink, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function Last5Stats({ activities }: { activities: Activity[] }) {
  const { t } = useT();

  // Memoised — 10 .map + .avg* passes per render of the feed. Now
  // recomputes only when activities change.
  const s = useMemo(() => {
    const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
    const last5  = sorted.slice(0, 5);
    return {
      last5,
      dur:      formatAvgDuration(last5),
      dist:     avg(last5.map(a => a.distance)),
      elev:     avgInt(last5.map(a => a.elevation)),
      speed:    avg(last5.map(a => a.speed)),
      hr:       avgInt(last5.map(a => a.avg_hr)),
      np:       avgInt(last5.map(a => a.np)),
      avgPower: avgInt(last5.map(a => a.avg_power)),
      tss:      avgInt(last5.map(a => a.tss)),
      wkg:      avg(last5.map(a => a.wkg)),
      cal:      avgInt(last5.map(a => a.calories)),
    };
  }, [activities]);

  if (s.last5.length < 2) return null;
  const { last5, dur, dist, elev, speed, hr, np, avgPower, tss, wkg, cal } = s;

  // - marginBottom: 16 to match Goals card's bottom margin.
  // - flex: 1 so the card stretches to fill its parent flex column
  //   (set by the wrapper in FeedPage). The right column's Calendar
  //   + Goals stack is usually taller than this card's natural
  //   content height, so without `flex: 1` we'd see a misaligned
  //   bottom edge. Empty space lands below the chip row inside the
  //   card — acceptable visual cost for the alignment.
  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 16,
    flex: 1,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.blue }}>{t('last5.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('last5.label')}</Label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 40px', paddingBottom: 20, borderBottom: `1px solid ${tokens.creamBorder}`, marginBottom: 20 }}>
        <Stat label={t('last5.duration')}    value={dur}   />
        <Stat label={t('analysis.distance')} value={dist}  unit="km" />
        <Stat label={t('common.elev')}       value={elev}  unit="m" />
        <Stat label={t('last5.speed')}       value={speed} unit="km/h" />
        {hr       && <Stat label={t('last5.hr')}    value={hr}       unit="bpm" color={tokens.terra} />}
        {avgPower && <Stat label={t('last5.power')} value={avgPower} unit="W"   color={tokens.green} />}
        {np       && <Stat label={t('last5.np')}    value={np}       unit="W"   color={tokens.green} />}
        {tss      && <Stat label={t('last5.tss')}   value={tss}                 color={tokens.terra} />}
        {wkg && <Stat label={t('last5.wkg')}        value={wkg}                 color={tokens.blue}  />}
        {cal && <Stat label={t('last5.cal')}        value={cal}                 unit="kcal" />}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {last5.map((a, i) => (
          <div key={a.id} style={{
            flex: 1, minWidth: 120, padding: '10px 14px',
            background: tokens.creamDark, borderRadius: 3,
            borderTop: `3px solid ${i === 0 ? tokens.terra : tokens.creamBorder}`,
          }}>
            <Label style={{ display: 'block', marginBottom: 4, fontSize: 9 }}>{a.date}</Label>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: 15, fontWeight: 700, color: tokens.ink, marginBottom: 2 }}>{a.distance} km</div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>{a.elevation} m · {a.duration}</div>
            {a.tss != null && <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.terra, marginTop: 2 }}>TSS {a.tss}</div>}
            {a.avg_power != null && <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.green, marginTop: 1 }}>{a.avg_power} W moy.</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FeedPage ──────────────────────────────────────────────────────────────────

interface Props {
  activities: Activity[];
  stats: GlobalStats;
  sport: SportId;        // can be any of the 7 sports
  onSelect: (a: Activity) => void;
}

export function FeedPage({ activities, stats, sport, onSelect }: Props) {
  const isMobile = useIsMobile();
  const { t } = useT();
  const { data: session } = useSession();

  // Fire-and-forget engagement beacon — server debounces to 1/hour
  // per user so refreshing the home page 30× doesn't spam the
  // events table. Without this the live tail on /admin/metrics
  // stays empty unless someone hits a lifecycle event (signin /
  // sync / export), which over-rotates on auth and makes the
  // tail useless for "is anyone actually using the app?".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    void fetch('/api/me/track', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event: 'home_view' }),
    }).catch(() => { /* best-effort */ });
  }, []);

  // Auto-complete the sync pipeline on first landing. Some flows
  // (signing in via Strava on /login → no ?strava=connected param)
  // leave the user with a Strava-linked account but ZERO synced
  // activities, or with summaries but no streams. Without this
  // effect they'd have to find the RE-SYNCER STRAVA button to get
  // a complete dashboard — every new user reported that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionUser = session?.user as any;
  const sessionAthleteId = sessionUser?.athleteId as number | null | undefined;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!sessionAthleteId) return;
    // Guard MUST survive a reload. We call window.location.reload()
    // below, and a window-scoped flag (the old `__tleAutoSyncFired`) is
    // wiped by that reload — so the chain re-fired on every load. Since
    // one of the triggers is "some activities still miss GPS", and
    // indoor sessions (yoga, weights, home-trainer) can NEVER get a
    // GPS track, that condition stayed true forever and produced an
    // infinite "sync → reload → sync → reload" loop for any user with
    // a single GPS-less activity. sessionStorage persists across
    // reloads within the tab, so the pipeline runs at most once per
    // session. Setting it up-front (before any early return) means even
    // the no-op path can't re-arm the loop.
    try {
      if (sessionStorage.getItem('tle_autosync_done') === '1') return;
      sessionStorage.setItem('tle_autosync_done', '1');
    } catch { /* private mode: the progress gate below still stops the loop */ }

    // Two triggers to fire the auto-chain:
    //   (a) freshly-linked Strava with zero activities → /sync
    //       hasn't been run yet at all, kick the whole pipeline.
    //   (b) we have summaries but some rows are missing GPS — typical
    //       post-bulk-import state (real outdoor rides awaiting streams).
    const noActivitiesYet  = activities.length === 0;
    const missingMaps      = activities.filter(a => !a.gps || a.gps.length < 2).length;
    const someMissing      = missingMaps > 0;

    if (!noActivitiesYet && !someMissing) return;

    void (async () => {
      try {
        // Only reload if the pipeline actually fetched something new.
        // Reloading merely because some activities can never have GPS
        // (indoor) is exactly what caused the loop.
        let progressed = false;
        if (noActivitiesYet) {
          const r = await fetch('/api/strava/sync', { method: 'POST' });
          if (!r.ok) return;
          const j = await r.json().catch(() => ({})) as { count?: number };
          if ((j.count ?? 0) > 0) progressed = true;
        }
        // Loop streams backfill until done — bounded by the
        // endpoint's BATCH_SIZE (10/call), 50-iter outer cap so a
        // pathological user with 500 stream-less rows still
        // terminates.
        for (let i = 0; i < 50; i++) {
          const rr = await fetch('/api/strava/backfill-streams', { method: 'POST' });
          if (!rr.ok) break;
          const d = await rr.json() as { processed?: number; remaining?: number; done?: boolean };
          if ((d.processed ?? 0) > 0) progressed = true;
          if (d.done || ((d.processed ?? 0) === 0 && (d.remaining ?? 0) === 0)) break;
        }
        // Reload so the cards rerender against the freshly-synced
        // payloads — but ONLY when we actually pulled new data, so a
        // user whose remaining activities are all GPS-less doesn't
        // reload in a loop.
        if (progressed) window.location.reload();
      } catch { /* silent — manual RE-SYNCER STRAVA button still works */ }
    })();
  }, [sessionAthleteId, activities]);

  // Bike filter — null means "all bikes". Only meaningful when the
  // active sport is cycling AND the feed has activities tagged with
  // at least two distinct bikes (otherwise there's nothing to choose
  // between). Resets on every navigation since it's local state.
  const [bikeFilter, setBikeFilter] = useState<string | null>(null);

  // Distinct (gear_id, gear_name) pairs seen in the current activities
  // list. We derive this from the data itself rather than calling
  // /api/equipment a second time — the activities prop already
  // carries gear_name (denormalized server-side).
  const bikesSeen = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of activities) {
      if (a.type === 'cycling' && a.gear_id && a.gear_name) {
        map.set(a.gear_id, a.gear_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [activities]);
  const showBikeFilter = sport === 'cycling' && bikesSeen.length >= 2;

  // Apply the bike filter to the feed. When null, return the input
  // unchanged so the rest of the widgets (Last5Stats, Calendar, Goals,
  // PersonalRecords, TrainingProgram) operate on the full dataset.
  const filteredActivities = useMemo(() => {
    if (!bikeFilter) return activities;
    return activities.filter(a => a.gear_id === bikeFilter);
  }, [activities, bikeFilter]);

  // Empty state — used when a user has just signed up but Strava isn't
  // linked yet (or the sync hasn't run). All the downstream widgets
  // (charts, calendar, records, training program) look broken on an
  // empty data set, so we show a focused onboarding card instead.
  if (activities.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = session?.user as any;
    const firstName = (u?.name as string | undefined)?.split(/\s+/)[0] ?? 'à toi';
    const athleteId = (u?.athleteId as number | null | undefined) ?? null;
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
        <EmptyFeedState athleteId={athleteId} displayName={firstName} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={1} title={t('feed.sectionTag')} />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32 }}>
        {t('feed.headline', { count: stats.totalActivities })}<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>{t('feed.headlineEm')}</em>
      </h1>

      {/* Bike filter — only visible for cycling users with ≥2 bikes.
          Selecting a chip scopes every downstream widget (stats,
          calendar, records, cards) to that bike only. */}
      {showBikeFilter && (
        <BikeFilterBar
          bikes={bikesSeen}
          selected={bikeFilter}
          onSelect={setBikeFilter}
        />
      )}

      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: 'stretch',
        gap: 16,
      }}>
        {/* Left wrapper is now a flex column so the Last5Stats card
            inside can `flex: 1` and stretch to the row's full height
            — which is driven by the taller right column (Calendar +
            Goals). Result: card grows downward to match Goals' bottom. */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Last5Stats activities={filteredActivities} />
        </div>
        {/* Right column inherits the parent's alignItems: stretch (no
            more alignSelf: flex-start), so it grows to match the
            taller Last5Stats card on the left. justify-content:
            space-between pushes Calendar to the top and Goals to the
            bottom — visually aligning the bottoms of both columns
            without compressing the Last5Stats content. */}
        <div style={{
          flexShrink: 0,
          alignSelf: isMobile ? 'auto' : 'auto',
          display: 'flex', flexDirection: 'column',
          justifyContent: isMobile ? 'flex-start' : 'space-between',
        }}>
          <ActivityCalendar activities={filteredActivities} />
          <Goals activities={filteredActivities} />
        </div>
      </div>
      {/* Cycling power records + training program moved to the
          "Puissance & Charge" page. Running keeps its pace records here
          since it has no dedicated performance page. */}
      {sport === 'running' && <PersonalRecords activities={filteredActivities} sport={sport} />}
      {sport === 'running' && <RunPaceZones activities={filteredActivities} />}
      {sport === 'running' && <RaceProjector activities={filteredActivities} />}
      {/* Cycling-only — the whole TSS / NP / IF / FTP framework is
          power-meter-on-a-bike specific. Running has its own
          equivalents (Daniels / Banister) and our other sports
          (Yoga, Workout, Climb…) don't have a useful "next ride"
          model. Hide the card entirely outside cycling rather than
          render placeholders that ask the rider for data they
          can't have. */}

      {/* If the bike filter is on but matches no activities, surface
          a focused empty state with a one-click "Clear" — better than
          a silent blank below the widgets. */}
      {bikeFilter && filteredActivities.length === 0 ? (
        <div style={{
          marginTop: 24, padding: 28, textAlign: 'center',
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 4,
        }}>
          <div style={{ fontFamily: "'Playfair Display'", fontSize: 17, fontWeight: 700, color: tokens.ink, marginBottom: 6 }}>
            Aucune sortie sur ce vélo
          </div>
          <p style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, margin: '0 0 14px' }}>
            Sur la période / le sport actuels, rien à afficher pour ce vélo.
          </p>
          <button
            onClick={() => setBikeFilter(null)}
            style={{
              padding: '8px 14px', background: tokens.terra, color: '#fff',
              border: 'none', borderRadius: 3,
              fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
              letterSpacing: '0.04em', cursor: 'pointer',
            }}
          >
            Voir tous les vélos
          </button>
        </div>
      ) : (
        filteredActivities.map(a => <ActivityCard key={a.id} activity={a} onClick={onSelect} />)
      )}
    </div>
  );
}

/**
 * Bike filter chip row, surfaced only when ≥2 bikes are tagged in the
 * current feed. Single-select: clicking the active chip un-selects
 * (back to "Tous"). Lives between the headline and the stat widgets.
 */
function BikeFilterBar({
  bikes, selected, onSelect,
}: {
  bikes: { id: string; name: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8,
      marginBottom: isMobile ? 16 : 24,
      alignItems: 'center',
    }}>
      <Label style={{ marginRight: 4 }}>VÉLO</Label>
      <Chip label="Tous"     active={selected === null} onClick={() => onSelect(null)} />
      {bikes.map(b => (
        <Chip
          key={b.id}
          label={b.name}
          active={selected === b.id}
          onClick={() => onSelect(selected === b.id ? null : b.id)}
        />
      ))}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        background: active ? tokens.terra : tokens.surface,
        border: `1px solid ${active ? tokens.terra : tokens.creamBorder}`,
        borderRadius: 14,
        color: active ? '#fff' : tokens.inkMid,
        fontFamily: "'Space Grotesk'", fontSize: 11,
        fontWeight: active ? 700 : 500,
        letterSpacing: '0.04em',
        cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
    >
      {label}
    </button>
  );
}
