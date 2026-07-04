/**
 * Product-analytics event logger.
 *
 * Fire-and-forget inserts into `next_auth.events`. Used to feed the
 * /admin/metrics dashboard with DAU / funnel / sync-health numbers
 * from a single Postgres source of truth — no third-party SaaS, no
 * PII leaving Supabase.
 *
 * Convention: only log meaningful **lifecycle** events. Don't log
 * every page view or every API request — that's the job of Vercel
 * Analytics. Events here should be things a PM would put on a
 * funnel slide: signup, first_sync, ride_recorded, export,
 * disconnect_strava, delete_account, …
 *
 * Failure must NEVER break the underlying operation. The action has
 * already succeeded by the time we log it; an event-log hiccup is a
 * lost data point, not a user-facing error.
 */

import { supabaseAdmin } from './db';
import { NextRequest } from 'next/server';

/** Closed set of event types. Add a new one here before logging it. */
export type EventType =
  | 'signin'                  // every successful sign-in (web or iOS)
  | 'signup'                  // first sign-in for a given user (derived in dashboard)
  | 'first_sync'              // user's first Strava activity synced into Supabase
  | 'export'                  // GET /api/me/export 2xx
  | 'disconnect_strava'       // POST /api/me/disconnect-strava
  | 'logout_all'              // POST /api/me/logout-all
  | 'delete_account'          // DELETE /api/me
  | 'strava_webhook_received' // every incoming Strava webhook event
  | 'strava_webhook_synced'   // webhook → sync-one completed without error
  | 'rate_limited'            // any route triggered a 429 from the rate-limit middleware
  | 'plan_generated'          // user clicked "Génère le plan" (client-side beacon, future)
  | 'ride_recorded'           // iOS Track recorder saved a ride (client-side beacon, future)
  | 'healthkit_activity_ingested' // POST /api/activities/ingest — a workout came in via Apple Health (Strava-independent)
  // Session / engagement — broader than the lifecycle stuff above so
  // the live tail isn't permanently empty on a slow day. Each is
  // debounced server-side to once-per-user-per-hour (see /api/me/track)
  // so we don't drown the events table in noise.
  | 'home_view'               // user landed on / (web) or opened the iOS app
  | 'manual_resync'           // user clicked RE-SYNCER STRAVA in sidebar / /profil
  | 'activity_view'           // user opened an activity detail page
  // Onboarding funnel — each step fires its own event so the dashboard
  // can show drop-off rates.
  | 'onboarding_started'                  // first visit to /onboarding
  | 'onboarding_step_welcome_done'        // dismissed the welcome screen → started the flow
  | 'onboarding_step_sport_done'          // chose a sport
  | 'onboarding_step_profile_done'        // saved weight + FTP
  | 'onboarding_step_strava_connected'    // chose to connect Strava
  | 'onboarding_step_strava_skipped'      // chose to skip Strava
  | 'onboarding_complete';                // landed on home with onboarded_at set

export interface EventEntry {
  type:        EventType;
  userId?:     string | null;
  /** Free-form context. Strip secrets before passing. */
  properties?: Record<string, unknown>;
}

/**
 * Log an event. Best-effort — swallows errors so the caller never
 * has to wrap this in a try/catch.
 */
export async function logEvent(entry: EventEntry, req?: NextRequest | null): Promise<void> {
  try {
    await supabaseAdmin()
      .schema('next_auth')
      .from('events')
      .insert({
        user_id:    entry.userId ?? null,
        event_type: entry.type,
        properties: entry.properties ?? {},
        ip:         req ? clientIp(req) : null,
        user_agent: req ? req.headers.get('user-agent') ?? null : null,
      });
  } catch (err) {
    // Don't throw — the action succeeded, we're just losing a data point.
    console.error(`[events] insert ${entry.type} failed:`, err);
  }
}

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}
