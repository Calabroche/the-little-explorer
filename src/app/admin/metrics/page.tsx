'use client';

/**
 * /admin/metrics — product analytics dashboard.
 *
 * 4 sections, top to bottom:
 *   1. KPI tiles    (users / DAU today / signups 7d / exports total)
 *   2. DAU 30d      bar chart from /admin/metrics → dau[]
 *   3. Onboarding   funnel cards with absolute counts + conversion %
 *   4. Recent       table — last 25 events
 *
 * Everything fetches one endpoint (`GET /api/admin/metrics`) on mount
 * and on the "Rafraîchir" button. Server-side aggregation keeps the
 * client thin and the dashboard fast.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/components/explorer/tokens';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';

interface Metrics {
  totals: {
    users: number; activities: number; events_7d: number;
    signups_7d: number; exports_total: number; dau_today: number;
  };
  dau: { day: string; count: number }[];
  funnel: {
    signup: number; sport_done: number; profile_done: number;
    strava_connected: number; strava_skipped: number; complete: number;
  };
  events: { type: string; count: number }[];
  sync: { received_7d: number; synced_7d: number; success_rate: number };
  recent: { type: string; user_id: string | null; occurred_at: string; properties: Record<string, unknown> }[];
}

export default function MetricsPage() {
  const [data,    setData]    = useState<Metrics | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/metrics');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json() as Metrics);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    // `body { overflow: hidden }` in globals.css clamps the page —
    // give <main> its own scroll context or the metrics charts past
    // the first viewport are unreachable.
    <main style={{
      height:     '100vh',
      overflowY:  'auto',
      padding:    '40px 24px',
      background: tokens.cream,
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <Header onRefresh={load} loading={loading} />
        {error && (
          <div style={{
            padding: '10px 12px', marginBottom: 16,
            background: '#FEE', border: '1px solid #FCC', borderRadius: 4,
            color: '#A00', fontSize: 12,
          }}>{error}</div>
        )}
        {loading && !data && (
          <p style={{ color: tokens.inkLight, fontSize: 13 }}>Chargement des métriques…</p>
        )}
        {data && (
          <>
            <KpiGrid totals={data.totals} sync={data.sync} />
            <DauChart series={data.dau} />
            <FunnelSection funnel={data.funnel} />
            <EventBreakdown events={data.events} />
            <RecentTable rows={data.recent} />
          </>
        )}
      </div>
    </main>
  );
}

// ── Header ────────────────────────────────────────────────────────────
function Header({ onRefresh, loading }: { onRefresh: () => void; loading: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 24, gap: 16, flexWrap: 'wrap',
    }}>
      <div>
        <p style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: tokens.terra, margin: '0 0 4px',
        }}>§ MÉTRIQUES PRODUIT</p>
        <h1 style={{
          fontFamily: "'Playfair Display'", fontSize: 32, fontWeight: 800,
          color: tokens.ink, margin: 0, lineHeight: 1.15,
        }}>
          Comment l&apos;app tourne <span style={{ fontStyle: 'italic', fontWeight: 700 }}>en ce moment</span>.
        </h1>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onRefresh} disabled={loading} style={{
          padding: '8px 14px',
          background: tokens.terra, border: `1px solid ${tokens.terra}`,
          borderRadius: 3, color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          cursor: 'pointer',
        }}>{loading ? 'CHARGEMENT…' : 'RAFRAÎCHIR'}</button>
        <Link href="/admin" style={{
          padding: '8px 14px',
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 3, color: tokens.inkMid,
          fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
          textDecoration: 'none', display: 'inline-block',
        }}>← ADMIN</Link>
      </div>
    </div>
  );
}

// ── KPI tiles ─────────────────────────────────────────────────────────
function KpiGrid({ totals, sync }: { totals: Metrics['totals']; sync: Metrics['sync'] }) {
  const tiles = [
    { label: 'UTILISATEURS',  value: totals.users,         sub: 'total comptes' },
    { label: 'DAU AUJ.',      value: totals.dau_today,     sub: 'users actifs aujourd\'hui' },
    { label: 'SIGNUPS 7J',    value: totals.signups_7d,    sub: '7 derniers jours' },
    { label: 'EXPORTS',       value: totals.exports_total, sub: 'depuis le début' },
    { label: 'ACTIVITÉS',     value: totals.activities,    sub: 'rides en base' },
    { label: 'SYNC SUCCESS',  value: `${Math.round(sync.success_rate * 100)}%`, sub: `${sync.synced_7d}/${sync.received_7d} (7j)` },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: 10, marginBottom: 24,
    }}>
      {tiles.map(t => (
        <div key={t.label} style={{
          padding: 14,
          background: tokens.surface,
          border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 4,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            color: tokens.inkLight, textTransform: 'uppercase',
          }}>{t.label}</div>
          <div style={{
            fontFamily: "'Playfair Display'", fontSize: 28, fontWeight: 800,
            color: tokens.terra, margin: '4px 0 2px', lineHeight: 1.0,
          }}>{t.value}</div>
          <div style={{ fontSize: 10, color: tokens.inkLight }}>{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── DAU chart ─────────────────────────────────────────────────────────
function DauChart({ series }: { series: Metrics['dau'] }) {
  const empty = series.every(s => s.count === 0);
  return (
    <section style={{
      padding: 18, marginBottom: 24,
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        color: tokens.terra, marginBottom: 12, textTransform: 'uppercase',
      }}>DAU — 30 derniers jours</div>
      {empty ? (
        <p style={{ fontSize: 12, color: tokens.inkLight, padding: '24px 0', textAlign: 'center' }}>
          Pas encore d&apos;événements enregistrés. L&apos;instrumentation est active —
          dès qu&apos;un user signe / sync / export, ce chart se remplira.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: tokens.inkLight }}
              tickFormatter={d => d.slice(5)} // "MM-DD"
            />
            <YAxis tick={{ fontSize: 10, fill: tokens.inkLight }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, fontSize: 11 }}
              labelStyle={{ color: tokens.ink, fontWeight: 600 }}
            />
            <Bar dataKey="count" fill={tokens.terra} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

// ── Onboarding funnel ─────────────────────────────────────────────────
function FunnelSection({ funnel }: { funnel: Metrics['funnel'] }) {
  const steps = [
    { label: 'Signup',          count: funnel.signup,           color: tokens.terra },
    { label: 'Sport choisi',    count: funnel.sport_done,       color: tokens.terra },
    { label: 'Profil rempli',   count: funnel.profile_done,     color: tokens.terra },
    { label: 'Strava connecté', count: funnel.strava_connected, color: tokens.green },
    { label: '(skip Strava)',   count: funnel.strava_skipped,   color: tokens.inkLight },
    { label: 'Complete',        count: funnel.complete,         color: tokens.green },
  ];
  const top = Math.max(...steps.map(s => s.count), 1);
  return (
    <section style={{
      padding: 18, marginBottom: 24,
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        color: tokens.terra, marginBottom: 12, textTransform: 'uppercase',
      }}>Funnel onboarding</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {steps.map(s => (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 60px', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: tokens.inkMid }}>{s.label}</span>
            <div style={{
              height: 8, background: tokens.creamBorder, borderRadius: 4, overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.max(2, (s.count / top) * 100)}%`,
                height: '100%',
                background: s.color,
                transition: 'width 320ms ease',
              }} />
            </div>
            <span style={{
              fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700,
              color: tokens.ink, textAlign: 'right',
            }}>{s.count}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 12, fontSize: 11, color: tokens.inkLight, lineHeight: 1.5 }}>
        Conversion signup → complete : <strong style={{ color: tokens.ink }}>
          {funnel.signup === 0 ? '—' : `${Math.round((funnel.complete / funnel.signup) * 100)}%`}
        </strong>
        {funnel.signup > 0 && funnel.strava_skipped > 0 && (
          <> · skip-Strava : <strong style={{ color: tokens.ink }}>
            {Math.round((funnel.strava_skipped / (funnel.strava_connected + funnel.strava_skipped || 1)) * 100)}%
          </strong></>
        )}
      </p>
    </section>
  );
}

// ── Event type breakdown ──────────────────────────────────────────────
function EventBreakdown({ events }: { events: Metrics['events'] }) {
  if (events.length === 0) return null;
  const top = events[0].count;
  return (
    <section style={{
      padding: 18, marginBottom: 24,
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        color: tokens.terra, marginBottom: 12, textTransform: 'uppercase',
      }}>Top events — 7 derniers jours</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {events.map(e => (
          <div key={e.type} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 40px', alignItems: 'center', gap: 12 }}>
            <code style={{ fontSize: 11, color: tokens.inkMid }}>{e.type}</code>
            <div style={{ height: 6, background: tokens.creamBorder, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(3, (e.count / top) * 100)}%`,
                height: '100%',
                background: tokens.terra,
              }} />
            </div>
            <span style={{ fontSize: 12, color: tokens.ink, textAlign: 'right', fontWeight: 600 }}>{e.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Recent events table ───────────────────────────────────────────────
function RecentTable({ rows }: { rows: Metrics['recent'] }) {
  return (
    <section style={{
      padding: 18, marginBottom: 24,
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        color: tokens.terra, marginBottom: 12, textTransform: 'uppercase',
      }}>Live tail — 25 derniers events</div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: tokens.inkLight }}>Aucun event encore.</p>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '120px 200px 80px 1fr',
              gap: 12,
              padding: '6px 8px',
              fontSize: 11,
              borderBottom: `1px solid ${tokens.creamBorder}`,
              alignItems: 'center',
            }}>
              <code style={{ color: tokens.terra, fontWeight: 600 }}>{r.type}</code>
              <span style={{ color: tokens.inkLight }}>
                {new Date(r.occurred_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
              <code style={{ color: tokens.inkLight, fontSize: 10 }}>
                {r.user_id ? r.user_id.slice(0, 8) : '—'}
              </code>
              <code style={{ color: tokens.inkMid, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {Object.keys(r.properties).length === 0 ? '' : JSON.stringify(r.properties)}
              </code>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
