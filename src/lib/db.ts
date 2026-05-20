/**
 * Supabase client singletons.
 *
 * Two clients live here because the access pattern is split:
 *
 *   - `supabaseAdmin` uses the **service-role key**, bypasses RLS, and is
 *     server-side only. It's what API routes and the NextAuth adapter talk
 *     to. NEVER import this from a `'use client'` component.
 *
 *   - `supabasePublic` uses the **anon key**. It's safe to ship to the
 *     browser. We keep it around for cases where we want the client to
 *     subscribe to realtime changes; today nothing uses it but it's the
 *     natural place to grow from.
 *
 * Env vars (must be present at runtime, set via Vercel + .env.local):
 *
 *   SUPABASE_URL                  — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     — server-side secret (NEVER commit)
 *   NEXT_PUBLIC_SUPABASE_URL      — same value as SUPABASE_URL but exposed to browser
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — public anon key
 *
 * We do NOT throw at import time if the env is missing — that would brick
 * the whole build during a CI dry-run on a fresh clone. Instead, the
 * accessor functions throw lazily so the existing JSON-file code path keeps
 * working until Supabase is wired up.
 */

// Must come BEFORE the supabase-js import — sets globalThis.WebSocket
// on Node < 22 so the supabase-js RealtimeClient constructor doesn't
// throw at module load. No-op on Vercel / Node 18+.
import './polyfill-ws';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _admin:  SupabaseClient | null = null;
let _public: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[db] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured. ' +
      'Add them to .env.local (and Vercel project env) before calling supabaseAdmin().',
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

export function supabasePublic(): SupabaseClient {
  if (_public) return _public;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('[db] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not configured.');
  }
  _public = createClient(url, key);
  return _public;
}

/** Returns true iff the server-side Supabase env is wired up. Useful for
 *  feature-flagging the new DB code path during rollout. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
