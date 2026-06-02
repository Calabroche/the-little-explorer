/**
 * GET /api/debug/events-probe
 *
 * Tests writing to + reading from next_auth.events. Returns the
 * raw error from PostgREST if the insert fails — usually the
 * smoking gun for "metrics dashboard shows 0 everywhere even
 * though users are signing in / syncing / etc."
 *
 * Admin-only. Remove after the issue is resolved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { isAdminEmail } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.email || !isAdminEmail(authed.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = supabaseAdmin();

  // 1) Count rows currently in next_auth.events.
  const { count: rowCount, error: countErr } = await db
    .schema('next_auth')
    .from('events')
    .select('*', { count: 'exact', head: true });

  // 2) Try writing a debug event.
  const { data: insData, error: insErr } = await db
    .schema('next_auth')
    .from('events')
    .insert({
      event_type: 'admin_debug_probe',
      properties: { stamp: new Date().toISOString() },
    })
    .select('id, event_type, occurred_at')
    .single();

  // 3) Type breakdown of what's already in there (top 10 types).
  const { data: typesRaw } = await db
    .schema('next_auth')
    .from('events')
    .select('event_type, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(50);
  const typeCounts = new Map<string, number>();
  for (const row of typesRaw ?? []) {
    const t = (row as { event_type: string }).event_type;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const types = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return NextResponse.json({
    table_total_rows: rowCount,
    table_count_error: countErr ? { message: countErr.message, hint: (countErr as { hint?: string }).hint, code: (countErr as { code?: string }).code } : null,
    insert_succeeded:  !insErr,
    inserted_row:      insData,
    insert_error:      insErr ? { message: insErr.message, hint: (insErr as { hint?: string }).hint, code: (insErr as { code?: string }).code, details: (insErr as { details?: string }).details } : null,
    recent_50_types:   types,
  });
}
