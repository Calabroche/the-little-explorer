/**
 * POST /api/perf — ingest a batch of real-user performance samples.
 *
 * The client collector (PerfCollector) measures API round-trips, page
 * navigation timing, and LCP, then flushes them here in batches (sendBeacon on
 * page hide). Auth required so we can attach user_id and rate-limit; the data
 * is only ever read back by admins on /admin/perf.
 *
 * Body: { samples: Array<{ kind: 'api'|'nav'|'vital', label: string,
 *                          ms: number, status?: number|null }> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KINDS = new Set(['api', 'nav', 'vital']);
const MAX_BATCH = 60;

interface Sample { kind: string; label: string; ms: number; status?: number | null }

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Generous limit — the collector flushes at most a few times per minute, but
  // each flush carries a batch.
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'perf-ingest', { userId: authed.id });
  if (limited) return limited;

  let body: { samples?: unknown };
  try { body = await req.json() as { samples?: unknown }; }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const raw = Array.isArray(body.samples) ? body.samples : [];
  const rows: { kind: string; label: string; ms: number; status: number | null; user_id: string }[] = [];
  for (const s of raw.slice(0, MAX_BATCH) as Sample[]) {
    if (!s || typeof s !== 'object') continue;
    if (!KINDS.has(s.kind)) continue;
    if (typeof s.label !== 'string' || s.label.length === 0) continue;
    if (typeof s.ms !== 'number' || !Number.isFinite(s.ms) || s.ms < 0 || s.ms > 600000) continue;
    const status = typeof s.status === 'number' && Number.isFinite(s.status) ? Math.trunc(s.status) : null;
    rows.push({
      kind:    s.kind,
      label:   s.label.slice(0, 120),
      ms:      Math.round(s.ms * 100) / 100,
      status,
      user_id: authed.id,
    });
  }

  if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

  const { error } = await supabaseAdmin().from('perf_samples').insert(rows);
  if (error) {
    console.error('[perf] insert failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: rows.length });
}
