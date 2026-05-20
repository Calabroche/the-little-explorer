-- ─────────────────────────────────────────────────────────────────────────────
-- The Little Explorer — Supabase schema (multi-user)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Re-runnable. Apply once in the Supabase SQL editor (or via `supabase db push`).
--
-- IMPORTANT — after running this, expose the next_auth schema in Supabase:
--   Project Settings → API → "Exposed schemas" → add `next_auth` to the list
--   (default is "public,storage,graphql_public") → Save.
-- Without that step, the PostgREST API used by @next-auth/supabase-adapter
-- can't reach the tables and login fails with ?error=google.
--
-- Why this shape:
--   * The `@next-auth/supabase-adapter` (legacy NextAuth v4 adapter) expects
--     its tables in a `next_auth` schema, with camelCase quoted column names
--     ("emailVerified", "providerAccountId", "userId", "sessionToken"). Our
--     first attempt used snake_case in `public`, which failed silently.
--   * We extend `next_auth.users` with `athlete_id` + `strava_scope` so the
--     Strava webhook can route incoming events back to the right user.
--   * Activity rows live in `public.activities` (our own data, our schema
--     conventions) with a FK to `next_auth.users(id)`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Cleanup any tables left over from the first (incorrect) migration ───────
drop table if exists public.activities          cascade;
drop table if exists public.sessions            cascade;
drop table if exists public.accounts            cascade;
drop table if exists public.verification_tokens cascade;
drop table if exists public.users               cascade;
drop function if exists public.user_by_athlete(bigint) cascade;

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── NextAuth schema (verbatim from @next-auth/supabase-adapter/supabase/migrations) ──
create schema if not exists next_auth;

grant usage on schema next_auth to service_role;
grant all   on schema next_auth to postgres;

-- next_auth.users — with our two extension columns (athlete_id, strava_scope)
create table if not exists next_auth.users (
  id              uuid not null default uuid_generate_v4(),
  name            text,
  email           text,
  "emailVerified" timestamp with time zone,
  image           text,
  -- Strava extension columns (populated by signIn callback when the user
  -- completes Strava OAuth — nullable because Google-first sign-in skips this)
  athlete_id      bigint,
  strava_scope    text,
  -- Track signup time so the admin dashboard can sort users by recency.
  -- NextAuth's default adapter schema doesn't ship this; we add it as
  -- our own extension column.
  created_at      timestamp with time zone default now(),
  constraint users_pkey      primary key (id),
  constraint email_unique    unique (email),
  constraint athlete_unique  unique (athlete_id)
);

-- Re-runnable migrations for existing installs that ran the schema
-- before these columns were added.
alter table if exists next_auth.users
  add column if not exists created_at timestamp with time zone default now();
-- Per-user training profile overrides. Default fallback ladder when
-- these are null: PROFILES_BY_EMAIL (legacy hardcoded for Florian +
-- Helena) → DEFAULT_PROFILE (70kg rider, 9kg bike). custom_ftp
-- overrides the derived FTP that comes from best 20-min power.
alter table if exists next_auth.users
  add column if not exists rider_kg    numeric(5,2);
alter table if exists next_auth.users
  add column if not exists bike_kg     numeric(5,2);
alter table if exists next_auth.users
  add column if not exists custom_ftp  integer;

grant all on table next_auth.users to postgres;
grant all on table next_auth.users to service_role;

-- uid() helper used by RLS policies if you ever wire them up
create or replace function next_auth.uid() returns uuid
  language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;

create table if not exists next_auth.sessions (
  id            uuid not null default uuid_generate_v4(),
  expires       timestamp with time zone not null,
  "sessionToken" text not null,
  "userId"      uuid,
  constraint sessions_pkey         primary key (id),
  constraint "sessionToken_unique" unique ("sessionToken"),
  constraint "sessions_userId_fkey" foreign key ("userId")
    references next_auth.users (id) on delete cascade
);

grant all on table next_auth.sessions to postgres;
grant all on table next_auth.sessions to service_role;

create table if not exists next_auth.accounts (
  id                  uuid not null default uuid_generate_v4(),
  type                text not null,
  provider            text not null,
  "providerAccountId" text not null,
  refresh_token       text,
  access_token        text,
  expires_at          bigint,
  token_type          text,
  scope               text,
  id_token            text,
  session_state       text,
  oauth_token_secret  text,
  oauth_token         text,
  -- Strava-specific: its /oauth/token response ships an `athlete` JSON
  -- object alongside the standard OAuth fields. NextAuth's adapter
  -- writes the whole token payload into this table verbatim, so we
  -- need a column to hold it — otherwise the insert 400s with
  -- PGRST204 ("column not in schema cache") and signin fails with
  -- ?error=Callback.
  athlete             jsonb,
  "userId"            uuid,
  constraint accounts_pkey        primary key (id),
  constraint provider_unique      unique (provider, "providerAccountId"),
  constraint "accounts_userId_fkey" foreign key ("userId")
    references next_auth.users (id) on delete cascade
);

-- Re-runnable migration of athlete column for existing installs that
-- ran the original schema.sql before this fix landed.
alter table if exists next_auth.accounts add column if not exists athlete jsonb;

grant all on table next_auth.accounts to postgres;
grant all on table next_auth.accounts to service_role;

create table if not exists next_auth.verification_tokens (
  identifier text,
  token      text,
  expires    timestamp with time zone not null,
  constraint verification_tokens_pkey  primary key (token),
  constraint token_unique              unique (token),
  constraint token_identifier_unique   unique (token, identifier)
);

grant all on table next_auth.verification_tokens to postgres;
grant all on table next_auth.verification_tokens to service_role;

-- ── Activities (our own table, our own conventions) ─────────────────────────
create table if not exists public.activities (
  id              bigint primary key,                  -- Strava activity id
  user_id         uuid not null references next_auth.users(id) on delete cascade,
  sport           text not null,
  original_type   text,
  title           text,
  start_date      timestamptz not null,
  duration_min    integer,
  distance_km     numeric(8,2),
  elevation_m     integer,
  payload         jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists activities_user_date_idx  on public.activities (user_id, start_date desc);
create index if not exists activities_user_sport_idx on public.activities (user_id, sport);

-- ── Helper RPC: find user by Strava athlete id (used by webhook) ────────────
create or replace function public.user_by_athlete(p_athlete_id bigint)
returns uuid
language sql stable as $$
  select id from next_auth.users where athlete_id = p_athlete_id limit 1;
$$;
