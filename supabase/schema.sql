-- ─────────────────────────────────────────────────────────────────────────────
-- The Little Explorer — Supabase schema (multi-user)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Apply once in the Supabase SQL editor (or `supabase db push` if you wire up
-- the CLI). Designed for:
--   - NextAuth.js session storage (users / accounts / sessions / verification_tokens)
--   - Strava activity persistence keyed by user (activities)
--   - athlete_id → user lookup so the webhook can route incoming events
--
-- Schema notes:
--   * `users.athlete_id` is set when the user completes the Strava OAuth flow.
--     It's nullable because a user can sign in with Google first and connect
--     Strava later.
--   * `activities` stores the same shape the JSON files used to ship, but
--     normalised into columns + a `payload` JSONB blob for the streams /
--     advanced metrics that are too unwieldy to flatten.
--   * RLS is OFF for now — all access is via the service-role key from
--     server-side API routes. We can layer RLS later if we expose the DB
--     directly to the client.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── NextAuth tables (mirrors @auth/supabase-adapter expectations) ───────────
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  name            text,
  email           text unique,
  email_verified  timestamptz,
  image           text,
  -- Strava-specific extension columns. Populated by /api/strava/callback.
  athlete_id      bigint unique,
  strava_scope    text,
  created_at      timestamptz not null default now()
);

create table if not exists accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  type                text not null,
  provider            text not null,
  provider_account_id text not null,
  refresh_token       text,
  access_token        text,
  expires_at          bigint,
  token_type          text,
  scope               text,
  id_token            text,
  session_state       text,
  unique (provider, provider_account_id)
);

create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  expires       timestamptz not null,
  session_token text not null unique
);

create table if not exists verification_tokens (
  identifier text not null,
  token      text not null unique,
  expires    timestamptz not null,
  primary key (identifier, token)
);

-- ── Activities ──────────────────────────────────────────────────────────────
-- One row per Strava activity, scoped to a user. The `payload` column keeps
-- the heavy stream data (speed_kmh[], altitude[], gps[], heartrate[], …) so
-- we don't bloat the column list. Top-level columns are the ones we filter /
-- sort by.
create table if not exists activities (
  id              bigint primary key,                       -- Strava activity id
  user_id         uuid not null references users(id) on delete cascade,
  sport           text not null,                            -- normalised: cycling / running / hiking / ski / …
  original_type   text,                                     -- raw Strava type
  title           text,
  start_date      timestamptz not null,
  duration_min    integer,
  distance_km     numeric(8,2),
  elevation_m     integer,
  payload         jsonb not null,                           -- full raw + computed shape
  created_at      timestamptz not null default now()
);

create index if not exists activities_user_date_idx on activities (user_id, start_date desc);
create index if not exists activities_user_sport_idx on activities (user_id, sport);

-- ── Helper: find user by Strava athlete id (used by webhook) ────────────────
-- Selecting from the table is fine, but having a tiny SQL helper makes the
-- intent obvious in API code that does `await supabase.rpc('user_by_athlete', …)`.
create or replace function user_by_athlete(p_athlete_id bigint)
returns uuid
language sql stable as $$
  select id from users where athlete_id = p_athlete_id limit 1;
$$;
