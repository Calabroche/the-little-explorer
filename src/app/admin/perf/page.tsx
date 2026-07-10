'use client';

/**
 * /admin/perf — real-user performance dashboard. Admin-only.
 *
 * Ranks API routes by p95 latency, surfaces page navigation timing (TTFB /
 * DOMContentLoaded / load) and LCP, from samples collected by PerfCollector.
 * Use it to find what's actually slow rather than guessing.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell } from 'recharts';
import { tokens } from '@/components/explorer/tokens';

interface Stat { label: string; count: number; p50: number; p95: number; avg: number; max: number; errorRate: number }
interface PerfData { window: string; totalSamples: number; truncated: boolean; api: Stat[]; nav: Stat[]; vital: Stat[] }

const WINDOWS: { key: string; label: string }[] = [
  { key: '1h', label: '1 h' },
  { key: '24h', label: '24 h' },
  { key: '7d', label: '7 j' },
];

// Latency colour thresholds (ms). API and page-load use different scales.
function apiColor(ms: number) { return ms < 300 ? tokens.green : ms < 800 ? '#C98A2B' : '#B5402F'; }
function loadColor(ms: number) { return ms < 1000 ? tokens.green : ms < 2500 ? '#C98A2B' : '#B5402F'; }

export default function PerfPage() {
  const [data, setData] = useState<PerfData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState('24h');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/perf?window=${win}`);
      if (!r.ok) throw new Error(r.status === 403 ? 'Réservé aux admins.' : `HTTP ${r.status}`);
      setData(await r.json() as PerfData);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur inconnue');
    } finally { setLoading(false); }
  }, [win]);

  useEffect(() => { void load(); }, [load]);

  const nav = (label: string) => data?.nav.find(n => n.label === label);
  const lcp = data?.vital.find(v => v.label === 'lcp');
  const topSlow = (data?.api ?? []).slice(0, 12).map(s => ({ ...s, short: s.label.replace(/^\/api\//, '') }));

  return (
    <main style={{ height: '100vh', overflowY: 'auto', padding: '40px 24px', background: tokens.cream, fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, fontWeight: 900, color: tokens.ink, margin: 0 }}>Performance</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            {WINDOWS.map(w => (
              <button key={w.key} onClick={() => setWin(w.key)} style={{
                padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${win === w.key ? tokens.terra : tokens.creamBorder}`,
                background: win === w.key ? tokens.terra : tokens.surface,
                color: win === w.key ? '#fff' : tokens.inkMid, fontSize: 13, fontWeight: 600,
              }}>{w.label}</button>
            ))}
            <Link href="/admin" style={{ padding: '6px 14px', borderRadius: 999, border: `1px solid ${tokens.creamBorder}`, background: tokens.surface, color: tokens.inkMid, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Admin</Link>
          </div>
        </div>
        <p style={{ color: tokens.inkLight, fontSize: 13, marginTop: 0, marginBottom: 24 }}>
          Mesures réelles côté navigateur des utilisateurs. {data ? `${data.totalSamples.toLocaleString('fr')} échantillons${data.truncated ? ' (tronqué)' : ''} · fenêtre ${data.window}.` : ''}
        </p>

        {error && <div style={{ padding: 14, background: '#FEE', border: '1px solid #FCC', borderRadius: 6, color: '#A00' }}>{error}</div>}
        {loading && !data && <div style={{ color: tokens.inkMid }}>Chargement…</div>}

        {data && (
          <>
            {/* Page load + LCP cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
              <MetricCard title="TTFB" sub="temps jusqu'au 1er octet" stat={nav('ttfb')} color={loadColor} />
              <MetricCard title="DOM prêt" sub="DOMContentLoaded" stat={nav('dcl')} color={loadColor} />
              <MetricCard title="Chargement" sub="load complet" stat={nav('load')} color={loadColor} />
              <MetricCard title="LCP" sub="plus gros élément affiché" stat={lcp} color={loadColor} />
            </div>

            {/* Slowest API routes chart */}
            <SectionTitle>Routes API les plus lentes (p95)</SectionTitle>
            {topSlow.length === 0 ? (
              <Empty />
            ) : (
              <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <ResponsiveContainer width="100%" height={Math.max(160, topSlow.length * 30)}>
                  <BarChart data={topSlow} layout="vertical" margin={{ left: 12, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}ms`} />
                    <YAxis type="category" dataKey="short" width={180} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, fontSize: 11 }} labelStyle={{ color: tokens.ink, fontWeight: 600 }} />
                    <Bar dataKey="p95" radius={[0, 4, 4, 0]}>
                      {topSlow.map((s, i) => <Cell key={i} fill={apiColor(s.p95)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Full API table */}
            <SectionTitle>Toutes les routes API</SectionTitle>
            <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: tokens.inkLight, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <Th>Route</Th><Th right>Appels</Th><Th right>p50</Th><Th right>p95</Th><Th right>max</Th><Th right>erreurs</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.api.map(s => (
                    <tr key={s.label} style={{ borderTop: `1px solid ${tokens.creamBorder}` }}>
                      <Td><span style={{ fontFamily: 'monospace', color: tokens.ink }}>{s.label}</span></Td>
                      <Td right>{s.count.toLocaleString('fr')}</Td>
                      <Td right>{s.p50} ms</Td>
                      <Td right><span style={{ fontWeight: 700, color: apiColor(s.p95) }}>{s.p95} ms</span></Td>
                      <Td right>{s.max} ms</Td>
                      <Td right><span style={{ color: s.errorRate > 0 ? '#B5402F' : tokens.inkLight }}>{s.errorRate}%</span></Td>
                    </tr>
                  ))}
                  {data.api.length === 0 && <tr><Td>Aucune donnée pour cette fenêtre.</Td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function MetricCard({ title, sub, stat, color }: { title: string; sub: string; stat?: Stat; color: (ms: number) => string }) {
  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.ink }}>{title}</div>
      <div style={{ fontSize: 10, color: tokens.inkLight, marginBottom: 10 }}>{sub}</div>
      {stat ? (
        <>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, color: color(stat.p95) }}>{stat.p95} <span style={{ fontSize: 13 }}>ms</span></div>
          <div style={{ fontSize: 11, color: tokens.inkMid, marginTop: 2 }}>p50 {stat.p50} ms · {stat.count} mesures</div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: tokens.inkLight }}>—</div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.inkMid, margin: '8px 0 12px' }}>{children}</h2>;
}
function Empty() { return <div style={{ color: tokens.inkLight, fontSize: 13, marginBottom: 20 }}>Pas encore de données. Reviens après quelques minutes d&apos;utilisation.</div>; }
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ padding: '10px 14px', textAlign: right ? 'right' : 'left', fontWeight: 600 }}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: '9px 14px', textAlign: right ? 'right' : 'left', color: tokens.inkMid }}>{children}</td>;
}
