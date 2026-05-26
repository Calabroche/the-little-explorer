/**
 * GET /api/me/export — RGPD art. 20 (portability).
 *
 * Returns a JSON file containing everything we store about the
 * authenticated user, served with Content-Disposition: attachment so
 * the browser triggers a download instead of rendering it.
 *
 * Shape:
 *   {
 *     exportedAt:  ISO8601,
 *     schema:      "tle-export-v1",
 *     profile:     { id, email, name, athleteId, settings, effective },
 *     activities:  [ full Supabase rows including payload streams ],
 *   }
 *
 * Why streamed: Vercel Hobby caps response bodies at 4.5 MB. With full
 * payload streams (GPS / HR / altitude arrays — typically ~1 MB each
 * for a long bike ride), even a 6-ride user can exceed the buffer
 * limit. Streaming the response with a ReadableStream chunks the JSON
 * one activity at a time and bypasses that cap. Client-side fetch
 * still buffers the full body, which is fine — 10-50 MB in memory is
 * cheap; what we can't do is buffer 5+ MB inside the lambda.
 *
 * Out of scope here (intentional):
 *   - OAuth refresh tokens (security: never exported).
 *   - admin_audit entries about this user (those are operational
 *     metadata, not user content — and could leak the actor's
 *     identity if the user was action-targeted).
 *   - The legacy /data/users/<id>/ JSON files. Those are being
 *     phased out in favour of next_auth.users + public.activities.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same defaults as /api/me — kept in sync so the "effective" block
// matches what the rest of the app uses today.
const PROFILES_BY_EMAIL: Record<string, { riderKg: number; bikeKg: number }> = {
  'florian.calabrese@gmail.com': { riderKg: 66, bikeKg: 8.18 },
};
const DEFAULT_PROFILE = { riderKg: 70, bikeKg: 9 };

// Page size for streaming activities. Big enough that the per-page
// overhead is negligible, small enough that a single page's response
// stays well under any in-flight buffer Vercel might apply between
// chunks. Tuned for ~1MB-per-activity payloads.
const ACTIVITY_PAGE_SIZE = 5;

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 1. User row (settings + identity). Small and read once — no need
  //    to stream this part.
  const { data: user, error: userErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, email, name, image, athlete_id, rider_kg, bike_kg, custom_ftp, created_at')
    .eq('id', authed.id)
    .maybeSingle();
  if (userErr) {
    console.error('[me.export] user query failed:', userErr.message);
    return NextResponse.json({ error: 'db_error', detail: userErr.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  const legacy = user.email ? PROFILES_BY_EMAIL[user.email] : undefined;
  const effective = {
    riderKg:   user.rider_kg ?? legacy?.riderKg ?? DEFAULT_PROFILE.riderKg,
    bikeKg:    user.bike_kg  ?? legacy?.bikeKg  ?? DEFAULT_PROFILE.bikeKg,
    customFtp: user.custom_ftp ?? null,
  };

  const profileBlock = {
    id:         user.id,
    email:      user.email,
    name:       user.name,
    image:      user.image,
    athleteId:  user.athlete_id,
    createdAt:  user.created_at,
    settings: {
      rider_kg:   user.rider_kg,
      bike_kg:    user.bike_kg,
      custom_ftp: user.custom_ftp,
    },
    effective,
  };

  const filename = `the-little-explorer-export-${new Date().toISOString().slice(0, 10)}.json`;
  const encoder  = new TextEncoder();

  // 2. Stream the JSON document — header first, then activities in
  //    paged chunks, then close the array + outer object. Each `push`
  //    flushes a chunk to the client, so Vercel never holds more than
  //    a few KB of buffer in memory at once.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Header — exportedAt + schema + profile.
        controller.enqueue(encoder.encode(
          `{\n  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n` +
          `  "schema": "tle-export-v1",\n` +
          `  "profile": ${JSON.stringify(profileBlock, null, 2)},\n` +
          `  "activities": [\n`,
        ));

        // Activities, paged. Each page is fetched then streamed out
        // one row at a time. We stream in start_date descending order
        // (newest first) — same order as the Feed for consistency.
        let pageStart = 0;
        let first = true;
        // Hard ceiling so a runaway pagination loop can't run forever.
        const MAX_PAGES = 200;
        for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
          const { data: page, error: pageErr } = await supabaseAdmin()
            .from('activities')
            .select('id, sport, original_type, title, start_date, duration_min, distance_km, elevation_m, payload, created_at')
            .eq('user_id', authed.id)
            .order('start_date', { ascending: false })
            .range(pageStart, pageStart + ACTIVITY_PAGE_SIZE - 1);

          if (pageErr) {
            // Mid-stream errors: we've already started writing a 200
            // response and can't change the status. Close the JSON
            // gracefully with an error sentinel — the client can
            // detect this when parsing.
            console.error('[me.export] activities page query failed:', pageErr.message);
            controller.enqueue(encoder.encode(
              `${first ? '' : ',\n'}    {"__error": "activities_query_failed", "detail": ${JSON.stringify(pageErr.message)}}\n`,
            ));
            break;
          }
          if (!page || page.length === 0) break;

          for (const activity of page) {
            const prefix = first ? '    ' : ',\n    ';
            controller.enqueue(encoder.encode(prefix + JSON.stringify(activity)));
            first = false;
          }

          if (page.length < ACTIVITY_PAGE_SIZE) break; // last page
          pageStart += ACTIVITY_PAGE_SIZE;
        }

        // Close the array + outer object.
        controller.enqueue(encoder.encode(`\n  ]\n}\n`));
        controller.close();
      } catch (err) {
        console.error('[me.export] stream failed:', err);
        // Best-effort close — controller may already be torn down.
        try { controller.error(err); } catch { /* noop */ }
      }
    },
  });

  return new NextResponse(stream, {
    status:  200,
    headers: {
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Don't cache — this contains personal data, every request
      // should hit fresh state.
      'Cache-Control':       'no-store, max-age=0',
      // Hint to proxies / browsers that we're streaming — disables
      // any buffering they might otherwise apply waiting for the
      // full Content-Length.
      'Transfer-Encoding':   'chunked',
      'X-Accel-Buffering':   'no',
    },
  });
}
