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

-- ── API tokens (for native clients like the iOS app) ───────────────────────
-- One row per long-lived bearer token. Issued by /auth/native-done after
-- the user completes Google/Strava OAuth via ASWebAuthenticationSession.
-- The token itself (a 43-char base64url string) is stored in cleartext
-- because we need to look it up by exact match on every API request.
-- `label` is a human-readable hint ("iPhone 14", "Apple Watch") so the
-- user can revoke an individual device from /settings later.
create table if not exists next_auth.api_tokens (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references next_auth.users(id) on delete cascade,
  token         text not null unique,
  label         text,
  created_at    timestamp with time zone not null default now(),
  last_used_at  timestamp with time zone,
  revoked_at    timestamp with time zone
);
create index if not exists api_tokens_user_idx on next_auth.api_tokens (user_id);

-- Re-runnable for existing installs.
alter table if exists next_auth.api_tokens
  add column if not exists last_used_at timestamp with time zone;
alter table if exists next_auth.api_tokens
  add column if not exists revoked_at   timestamp with time zone;
-- Token expiry — defence-in-depth alongside `revoked_at`. A lost
-- phone whose token wasn't manually revoked stops being usable after
-- 90 days. New tokens issued by /auth/native-done get this stamped
-- to NOW() + 90d; old tokens (NULL expires_at) are grandfathered in
-- and treated as non-expiring until they're rotated.
alter table if exists next_auth.api_tokens
  add column if not exists expires_at   timestamp with time zone;
create index if not exists api_tokens_expires_idx
  on next_auth.api_tokens (expires_at)
  where expires_at is not null;

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

-- ── Bike maintenance tracker ───────────────────────────────────────────────
-- One row per wear-item the user is tracking (chain, brake pads, tires,
-- cables, etc.). We compute "km depuis la pose" as the sum of cycling
-- activity distance after `installed_at`; once that hits `lifetime_km`,
-- the UI flags the part as worn.
--
-- Convention:
--   * `installed_at_km` is the user's CUMULATIVE total cycling km at the
--     moment the part was installed. We store this once at install so
--     we don't need to re-sum activities on every page render — the
--     current km on the part = (total km today) − installed_at_km.
--   * `replaced_at` non-null = retired item, kept for history but not
--     shown in the "current setup" view.
--   * Lifetime is per-part — chains die at 3000 km, brake pads 2000,
--     tires 5000, BB 15000. We give sane defaults but the user can
--     override per item from the UI.
create table if not exists public.bike_equipment (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references next_auth.users(id) on delete cascade,
  name            text not null,
  -- Closed set so the UI can pick icons, default lifetimes, AND group
  -- the cards by category (cadre / transmission / freins / roues /
  -- autre). The frontend KIND_META map in EquipmentPage.tsx must stay
  -- in sync with these values. Add new types here when needed.
  kind            text not null check (kind in (
    -- Cadre
    'frame', 'fork',
    -- Transmission
    'chain', 'cassette', 'crankset', 'bottom_bracket',
    'derailleur_front', 'derailleur_rear', 'battery_di2',
    -- Freins
    'brake_lever_front', 'brake_lever_rear',
    'brake_pads_front', 'brake_pads_rear',
    'brake_rotor_front', 'brake_rotor_rear', 'brake_mount',
    -- Roues
    'wheel_front', 'wheel_rear',
    'tire_front', 'tire_rear',
    'thru_axle_front', 'thru_axle_rear',
    -- Autre
    'cables', 'bar_tape', 'pedals', 'other'
  )),
  installed_at    timestamptz not null default now(),
  installed_at_km numeric(10,2) not null default 0,
  lifetime_km     integer not null default 3000,
  replaced_at     timestamptz,                          -- null = still in use
  notes           text,
  created_at      timestamptz not null default now()
);
-- Re-runnable migration: existing installs need the constraint
-- relaxed so new kinds work. CHECK constraints can't be ALTERed in
-- place; drop + recreate.
alter table if exists public.bike_equipment
  drop constraint if exists bike_equipment_kind_check;
alter table if exists public.bike_equipment
  add constraint bike_equipment_kind_check check (kind in (
    'frame', 'fork',
    'chain', 'cassette', 'crankset', 'bottom_bracket',
    'derailleur_front', 'derailleur_rear', 'battery_di2',
    'brake_lever_front', 'brake_lever_rear',
    'brake_pads_front', 'brake_pads_rear',
    'brake_rotor_front', 'brake_rotor_rear', 'brake_mount',
    'wheel_front', 'wheel_rear',
    'tire_front', 'tire_rear',
    'thru_axle_front', 'thru_axle_rear',
    'cables', 'bar_tape', 'pedals', 'other'
  ));
create index if not exists bike_equipment_user_idx
  on public.bike_equipment (user_id, replaced_at);

grant all on table public.bike_equipment to postgres;
grant all on table public.bike_equipment to service_role;

-- ── Helper RPC: find user by Strava athlete id (used by webhook) ────────────
create or replace function public.user_by_athlete(p_athlete_id bigint)
returns uuid
language sql stable as $$
  select id from next_auth.users where athlete_id = p_athlete_id limit 1;
$$;

-- ── Logout-from-all-devices: invalidate every web JWT for this user ─────────
-- We add a single timestamp; the NextAuth `jwt` callback compares the
-- JWT's `iat` against this column and rejects the session if the token
-- was issued before the cutoff. Combined with revoking all api_tokens
-- rows (for iOS bearer auth), this gives a true "log out everywhere".
alter table if exists next_auth.users
  add column if not exists session_invalidated_at timestamptz;

-- ── Admin audit log ─────────────────────────────────────────────────────────
-- Records every write action taken from /admin (revoke user, edit
-- allowlist, force-sync someone, etc.). Read-only actions are deliberately
-- NOT logged here — would be too noisy and provides little forensic value.
--
-- `actor_id`        — who took the action (admin's user id)
-- `action`          — short verb string ('revoke_session', 'force_sync', …)
-- `target_user_id`  — who the action was taken against (nullable for system-wide actions)
-- `payload`         — full action context (JSON; trimmed of secrets)
-- `ip`              — best-effort client IP for traceability
create table if not exists next_auth.admin_audit (
  id              uuid primary key default uuid_generate_v4(),
  actor_id        uuid not null references next_auth.users(id) on delete cascade,
  action          text not null,
  target_user_id  uuid          references next_auth.users(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  ip              text,
  created_at      timestamptz not null default now()
);
create index if not exists admin_audit_actor_idx   on next_auth.admin_audit (actor_id,   created_at desc);
create index if not exists admin_audit_target_idx  on next_auth.admin_audit (target_user_id, created_at desc);
create index if not exists admin_audit_action_idx  on next_auth.admin_audit (action, created_at desc);

grant all on table next_auth.admin_audit to postgres;
grant all on table next_auth.admin_audit to service_role;

-- ── Product analytics: events ──────────────────────────────────────────────
-- One row per meaningful event in the user lifecycle, persisted so the
-- /admin/metrics dashboard can compute DAU, funnel conversion, retention,
-- and sync health from a single source of truth.
--
-- Why bake our own instead of pulling PostHog / Mixpanel:
--   * One-shot SQL JOIN against `users` / `activities` for derived metrics
--     beats fetching from a SaaS event store.
--   * No PII leaving Supabase — every event sits in the same Postgres as
--     the user it describes. Consistent with the rest of the app's RGPD
--     posture (everything in `eu-west-3`, nothing shared with third parties).
--   * Keeps the side-project cost stack at zero.
--
-- Conventions:
--   * `event_type` is snake_case verb (`signup`, `first_sync`, `export`, …).
--   * `properties` is a free-form JSONB — use for context that varies per
--     event (e.g. `{"activities_synced": 12}` on first_sync). Strip secrets
--     before writing.
--   * `user_id` is nullable: anonymous events (e.g. failed sign-in attempts)
--     are still useful for sync-health.
--   * `occurred_at` defaults to now() — the client never sets it. Avoids
--     clock-skew issues.
create table if not exists next_auth.events (
  id          bigserial primary key,
  user_id     uuid references next_auth.users(id) on delete set null,
  event_type  text not null,
  properties  jsonb not null default '{}'::jsonb,
  ip          text,
  user_agent  text,
  occurred_at timestamptz not null default now()
);

-- Time-bucketed queries (DAU, daily counts) are the dashboard's hot
-- path → index by (event_type, occurred_at desc). Per-user queries (e.g.
-- "what's <user>'s most recent event") are second → index by
-- (user_id, occurred_at desc). The all-events-by-time index covers the
-- recent-events table at the bottom of the dashboard.
create index if not exists events_type_time_idx  on next_auth.events (event_type, occurred_at desc);
create index if not exists events_user_time_idx  on next_auth.events (user_id, occurred_at desc);
create index if not exists events_time_idx       on next_auth.events (occurred_at desc);

grant all on table next_auth.events to postgres;
grant all on table next_auth.events to service_role;

-- ── Onboarding state ──────────────────────────────────────────────────────
-- Stamped once when the user completes the 3-step onboarding flow at
-- /onboarding (sport pick → physical profile → Strava connect/skip).
-- The middleware redirects any signed-in user whose onboarded_at is NULL
-- to /onboarding, which means new sign-ups can't access the rest of the
-- app until they've filled in at least the minimum profile data.
--
-- Why a single timestamp rather than per-step columns:
--   * Each step's data is already captured in its own column (rider_kg,
--     bike_kg, custom_ftp, athlete_id), so we'd be storing the same fact
--     twice.
--   * The funnel analysis lives in `next_auth.events` instead — one
--     event per step (`onboarding_step_*`), which gives the dashboard
--     drop-off rates without bloating the user row.
alter table if exists next_auth.users
  add column if not exists onboarded_at timestamptz;
