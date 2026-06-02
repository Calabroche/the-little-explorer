'use client';

/**
 * /admin/metrics — product analytics dashboard.
 *
 * 4 sections, top to bottom:
 *   1. KPI tiles    (users / DAU today / signups 7d / exports total)
 *   2. DAU 30d      bar chart from /admin/metrics → dau[]
 *   3. Onboarding   funnel cards with absolute counts + conversion %
 *   4. Activité     per-user table — recent events grouped by user name,
 *                   each row expandable to show what that user did
 *
 * Everything fetches one endpoint (`GET /api/admin/metrics`) on mount
 * and on the "Rafraîchir" button. Server-side aggregation keeps the
 * client thin and the dashboard fast.
 */

import { useEffect, useState, useMemo, type CSSProperties } from 'react';  // useState needed by DauChart's window selector; useMemo groups the activity tail by user

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
    signup: number; welcome_done: number; sport_done: number; profile_done: number;
    strava_connected: number; strava_skipped: number; complete: number;
  };
  events: { type: string; count: number }[];
  sync: { received_7d: number; synced_7d: number; success_rate: number };
  recent: { type: string; user_id: string | null; userName: string | null; occurred_at: string; properties: Record<string, unknown> }[];
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
  // Window selector — the source series is always 30 days, we just
  // slice the tail to render a smaller window. No round-trip needed
  // since the data's already on the client.
  const [windowDays, setWindowDays] = useState<1 | 3 | 7 | 10 | 30>(30);
  const sliced = series.slice(-windowDays);
  const empty = sliced.every(s => s.count === 0);
  return (
    <section style={{
      padding: 18, marginBottom: 24,
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 12, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          color: tokens.terra, textTransform: 'uppercase',
        }}>DAU — {windowDays === 1 ? 'aujourd’hui' : `${windowDays} derniers jours`}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([1, 3, 7, 10, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              style={{
                padding: '4px 10px',
                background: windowDays === d ? tokens.terra : tokens.creamDark,
                border: `1px solid ${windowDays === d ? tokens.terra : tokens.creamBorder}`,
                borderRadius: 3,
                color: windowDays === d ? '#fff' : tokens.inkMid,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              {d}j
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        <p style={{ fontSize: 12, color: tokens.inkLight, padding: '24px 0', textAlign: 'center' }}>
          Pas encore d&apos;événements enregistrés. L&apos;instrumentation est active —
          dès qu&apos;un user signe / sync / export, ce chart se remplira.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={sliced}>
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
    { label: 'Bienvenue vue',   count: funnel.welcome_done,     color: tokens.terra },
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

// ── Per-user activity tail ────────────────────────────────────────────
type RecentRow = Metrics['recent'][number];

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const TH_STYLE: CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
  color: tokens.inkLight, textTransform: 'uppercase',
};

/**
 * Activity tail grouped by user. One row per person (name, last activity,
 * event count); click a row to expand the full list of what they did.
 * Avoids the flat 10k-line firehose the raw event stream would produce.
 */
function RecentTable({ rows }: { rows: Metrics['recent'] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Group newest-first rows by user, tracking each user's latest event.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; events: RecentRow[]; last: string }>();
    for (const r of rows) {
      const key  = r.user_id ?? '__anon__';
      const name = r.userName ?? (r.user_id ? r.user_id.slice(0, 8) : 'Anonyme');
      let g = map.get(key);
      if (!g) { g = { key, name, events: [], last: r.occurred_at }; map.set(key, g); }
      g.events.push(r);
      if (r.occurred_at > g.last) g.last = r.occurred_at;
    }
    return Array.from(map.values()).sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [rows]);

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const USER_COLS   = '1fr 150px 110px 28px';
  const DETAIL_COLS = 'minmax(160px, 1fr) 130px 2fr';

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
      }}>Activité par utilisateur</div>

      {groups.length === 0 ? (
        <p style={{ fontSize: 12, color: tokens.inkLight }}>Aucun event encore.</p>
      ) : (
        <div>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: USER_COLS, gap: 12,
            padding: '6px 8px', borderBottom: `2px solid ${tokens.creamBorder}`,
          }}>
            <span style={TH_STYLE}>Utilisateur</span>
            <span style={TH_STYLE}>Dernière activité</span>
            <span style={{ ...TH_STYLE, textAlign: 'right' }}>Événements</span>
            <span />
          </div>

          {groups.map(g => {
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key} style={{ borderBottom: `1px solid ${tokens.creamBorder}` }}>
                <button
                  onClick={() => toggle(g.key)}
                  style={{
                    display: 'grid', gridTemplateColumns: USER_COLS, gap: 12, width: '100%',
                    padding: '8px', alignItems: 'center', textAlign: 'left',
                    background: isOpen ? tokens.cream : 'transparent',
                    border: 'none', cursor: 'pointer', fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 600, color: tokens.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <span style={{ color: tokens.inkLight, fontSize: 11 }}>{fmtDateTime(g.last)}</span>
                  <span style={{ color: tokens.inkMid, textAlign: 'right' }}>{g.events.length}</span>
                  <span style={{ color: tokens.terra, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div style={{ padding: '4px 8px 12px 16px', background: tokens.cream }}>
                    {/* Detail column headers */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: DETAIL_COLS, gap: 12,
                      padding: '4px 0', borderBottom: `1px solid ${tokens.creamBorder}`,
                    }}>
                      <span style={TH_STYLE}>Événement</span>
                      <span style={TH_STYLE}>Date</span>
                      <span style={TH_STYLE}>Détails</span>
                    </div>
                    {g.events.map((e, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: DETAIL_COLS, gap: 12,
                        padding: '4px 0', fontSize: 11, alignItems: 'center',
                        borderBottom: `1px solid ${tokens.creamBorder}`,
                      }}>
                        <code style={{ color: tokens.terra, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.type}</code>
                        <span style={{ color: tokens.inkLight }}>{fmtDateTime(e.occurred_at)}</span>
                        <code style={{ color: tokens.inkMid, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {Object.keys(e.properties).length === 0 ? '—' : JSON.stringify(e.properties)}
                        </code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
