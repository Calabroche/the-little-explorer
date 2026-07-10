/**
 * GET /api/admin/perf?window=1h|24h|7d — performance rollup for /admin/perf.
 *
 * Admin-only (src/lib/admin.ts). Reads recent perf_samples and computes, per
 * route / metric, the call count, p50, p95, avg, max, and error rate — so the
 * dashboard can rank the slowest endpoints. Percentiles are computed here to
 * keep the client payload tiny.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { isAdminEmail } from '@/lib/admin';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WINDOWS: Record<string, number> = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3 };
const MAX_ROWS = 20000;

interface Row { kind: string; label: string; ms: number; status: number | null }
interface Stat { label: string; count: number; p50: number; p95: number; avg: number; max: number; errorRate: number }

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function summarize(rows: Row[]): Stat[] {
  const byLabel = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byLabel.get(r.label) ?? [];
    arr.push(r);
    byLabel.set(r.label, arr);
  }
  const out: Stat[] = [];
  byLabel.forEach((rs, label) => {
    const ms = rs.map(r => r.ms).sort((a, b) => a - b);
    const errors = rs.filter(r => r.status != null && (r.status === 0 || r.status >= 400)).length;
    out.push({
      label,
      count: rs.length,
      p50: Math.round(pct(ms, 50)),
      p95: Math.round(pct(ms, 95)),
      avg: Math.round(ms.reduce((s, v) => s + v, 0) / ms.length),
      max: Math.round(ms[ms.length - 1]),
      errorRate: Math.round((errors / rs.length) * 100),
    });
  });
  return out;
}

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(authed.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const windowKey = new URL(req.url).searchParams.get('window') ?? '24h';
  const windowMs = WINDOWS[windowKey] ?? WINDOWS['24h'];
  const since = new Date(Date.now() - windowMs).toISOString();

  const { data, error } = await supabaseAdmin()
    .from('perf_samples')
    .select('kind, label, ms, status')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    console.error('[admin.perf] query failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];
  const api = summarize(rows.filter(r => r.kind === 'api')).sort((a, b) => b.p95 - a.p95);
  const nav = summarize(rows.filter(r => r.kind === 'nav'));
  const vital = summarize(rows.filter(r => r.kind === 'vital'));

  return NextResponse.json({
    window: windowKey,
    totalSamples: rows.length,
    truncated: rows.length >= MAX_ROWS,
    api,
    nav,
    vital,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
