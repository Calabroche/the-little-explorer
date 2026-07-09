/**
 * GET /api/activities/<id>/view
 *
 * Read-only detail of ONE activity for the social layer: enough to render a
 * full map + elevation profile + headline stats for ANY activity the viewer is
 * allowed to see (own / public / followers-with-a-follow). Unlike /api/activities
 * this does NOT run the viewer's power/FTP/TSS math (that would be wrong across
 * authors) — it returns the ride's own summary + streams.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { viewerCanSeeActivity, loadAuthors, type Visibility } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAP_POINTS = 400;   // detail map can afford more points than a feed card

function downsample<T>(arr: T[], max: number): T[] {
  if (!Array.isArray(arr) || arr.length <= max) return Array.isArray(arr) ? arr : [];
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const viewerId = authed.id;

  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'activity-view', { userId: viewerId });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const access = await viewerCanSeeActivity(viewerId, id);
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('id, user_id, sport, title, start_date, duration_min, distance_km, elevation_m, visibility, gps:payload->gps, altitude:payload->altitude, heartrate:payload->heartrate, speed:payload->speed_kmh, avgspeed:payload->avg_speed_kmh, maxspeed:payload->max_speed_kmh, avghr:payload->avg_hr, maxhr:payload->max_hr')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('[activity-view] query failed:', error.message); return NextResponse.json({ error: 'db_error' }, { status: 500 }); }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = data;
  const authors = await loadAuthors([d.user_id as string]);

  return NextResponse.json({
    id:            Number(d.id),
    author:        authors.get(d.user_id as string) ?? { id: d.user_id, name: null, image: null },
    is_mine:       d.user_id === viewerId,
    sport:         d.sport,
    title:         d.title,
    date:          d.start_date,
    distance_km:   d.distance_km != null ? Number(d.distance_km) : null,
    elevation_m:   d.elevation_m ?? null,
    duration_min:  d.duration_min ?? null,
    avg_speed_kmh: d.avgspeed != null ? Number(d.avgspeed) : null,
    max_speed_kmh: d.maxspeed != null ? Number(d.maxspeed) : null,
    avg_hr:        d.avghr != null ? Number(d.avghr) : null,
    max_hr:        d.maxhr != null ? Number(d.maxhr) : null,
    gps:           downsample((d.gps as [number, number][]) ?? [], MAP_POINTS),
    altitude:      downsample((d.altitude as number[]) ?? [], MAP_POINTS),
    heartrate:     downsample((d.heartrate as number[]) ?? [], MAP_POINTS),
    speed_kmh:     downsample((d.speed as number[]) ?? [], MAP_POINTS),
    visibility:    (d.visibility as Visibility) ?? 'followers',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
