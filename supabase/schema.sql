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

-- Bearer tokens are stored HASHED (sha256 hex), never in clear. A database
-- dump / leaked backup must not hand out replayable session tokens: the
-- plaintext only ever lives in the one-time redirect and the device Keychain.
-- api-auth.ts hashes the incoming Bearer and looks up `token_hash`.
--
-- Zero-downtime migration order (see the security notes):
--   A. add the column + backfill hashes from the existing plaintext (both
--      columns valid → current iOS sessions keep working),
--   B. deploy the code that reads by hash,
--   C. drop the plaintext.
alter table if exists next_auth.api_tokens
  add column if not exists token_hash text;
create unique index if not exists api_tokens_hash_idx
  on next_auth.api_tokens (token_hash);
-- Step A backfill (needs pgcrypto for digest()).
create extension if not exists pgcrypto with schema extensions;
update next_auth.api_tokens
   set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 where token_hash is null and token is not null;
-- Step C (run only AFTER the hash-reading code is deployed):
--   alter table next_auth.api_tokens alter column token drop not null;
--   update next_auth.api_tokens set token = null where token_hash is not null;

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

-- ── Bike gears (= the user's bikes, as Strava knows them) ──────────────────
-- Cached from Strava's /api/v3/athlete bikes[] on every sync. We need
-- this to scope maintenance wear to a specific bike: if a user has a
-- Canyon + an e-bike, the chain on the Canyon only wears with rides
-- *on the Canyon* — summing both bikes' km gives a fake number.
--
-- Why text PK: Strava gear IDs are short strings (e.g. "b1234567"),
-- not bigints, so we match their storage format directly.
create table if not exists public.bike_gears (
  id            text primary key,
  user_id       uuid not null references next_auth.users(id) on delete cascade,
  name          text not null,                       -- Strava nickname ("Rocket")
  primary_bike  boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists bike_gears_user_idx on public.bike_gears (user_id);
grant all on table public.bike_gears to postgres;
grant all on table public.bike_gears to service_role;

-- Each activity is tagged with the Strava gear it was ridden on
-- (nullable — manual / non-tagged activities have no gear).
alter table if exists public.activities
  add column if not exists gear_id text;
create index if not exists activities_user_gear_idx
  on public.activities (user_id, gear_id) where gear_id is not null;

-- Each wear-item is bound to a specific bike. Null = legacy "any bike"
-- behaviour (sums all cycling km). We deliberately don't add an FK to
-- bike_gears because the user may install a piece before the gear sync
-- runs — the route handler validates membership at write time.
alter table if exists public.bike_equipment
  add column if not exists gear_id text;
create index if not exists bike_equipment_gear_idx
  on public.bike_equipment (gear_id) where gear_id is not null;

-- ── Carnet d'entretien (service log) ───────────────────────────────────────
-- One row per ad-hoc maintenance event the user performed: chain lube,
-- brake bleed, wheel true, etc. This is the *event* layer that lives
-- alongside bike_equipment's *piece lifecycle* layer:
--   • bike_equipment    = "this chain is on at km 0, replaced at km 3200"
--   • bike_service_events = "I lubed the chain at km 280, again at km 510"
--
-- The two together give the UI enough data to nag the user about
-- preventive maintenance ("your chain was lubed 280 km ago — typical
-- interval is 200 km, time to re-lube") without conflating the
-- "install/replace" semantics of the wear tracker.
--
-- Closed-set `kind` mirrors the SERVICE_KIND_META map on the frontend
-- (intervals, labels, icons).
create table if not exists public.bike_service_events (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references next_auth.users(id) on delete cascade,
  -- Strava gear_id. Nullable so legacy events (or "applies to any bike"
  -- ones like "tire pressure pump tune-up") can exist — but the UI
  -- always picks a bike when creating new ones.
  gear_id       text,
  kind          text not null check (kind in (
    'chain_lube', 'chain_clean',
    'brake_bleed', 'brake_pads_check',
    'wheel_true', 'tire_pressure',
    'derailleur_tune', 'bottom_bracket_check',
    'cable_check', 'bike_wash', 'general_service',
    'other'
  )),
  date          timestamptz not null default now(),
  -- Bike's cumulative km at the moment of the event (snapshotted so
  -- "next-due" math doesn't break when activities are re-synced).
  km_at_event   numeric(10,2),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists bike_service_events_user_date_idx
  on public.bike_service_events (user_id, date desc);
create index if not exists bike_service_events_gear_idx
  on public.bike_service_events (gear_id, date desc) where gear_id is not null;

grant all on table public.bike_service_events to postgres;
grant all on table public.bike_service_events to service_role;

-- ── Saved itineraries ──────────────────────────────────────────────────────
-- A planned tour the user built on /planificateur (web) or in the iOS
-- RouteBuilder. Stored as a single `payload` JSONB blob because we
-- only ever fetch / write the whole thing — we never query INSIDE the
-- waypoints / geometry arrays. Storing as JSONB keeps the schema
-- flexible if the Itinerary struct gains new fields without a migration.
--
-- `distance_km` is denormalised for cheap sorting and list display
-- (the iOS list view needs it before fetching the full payload).
--
-- id is a text key matching the client-generated `Itinerary.newId()`
-- format ("itin_<ts>_<rand>") so the same id round-trips between the
-- iPhone, the web app, and the Watch cache.
create table if not exists public.itineraries (
  id          text primary key,
  user_id     uuid not null references next_auth.users(id) on delete cascade,
  name        text not null,
  payload     jsonb not null,
  distance_km numeric(8,2),
  created_at  timestamptz not null default now()
);
create index if not exists itineraries_user_created_idx
  on public.itineraries (user_id, created_at desc);
grant all on table public.itineraries to postgres;
grant all on table public.itineraries to service_role;

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
-- PostgreSQL treats the bigserial PK's sequence as a SEPARATE
-- object from the table — granting the table doesn't grant
-- nextval() on the sequence. Without this, every insert from
-- supabaseAdmin() (service_role) failed with
--   permission denied for sequence events_id_seq  (SQLSTATE 42501)
-- and the metrics dashboard read 0 across the board even after
-- weeks of signins / syncs. Belt-and-suspenders: grant on the
-- explicit name AND on every existing/future sequence in the
-- schema, so future migrations that add new bigserial PKs
-- don't repeat the same trap.
grant usage, select on sequence next_auth.events_id_seq to service_role;
grant usage, select on all sequences in schema next_auth to service_role;
alter default privileges in schema next_auth grant usage, select on sequences to service_role;

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

-- ── Social layer: profiles, follows, likes, comments ────────────────────────
-- Strava-style social graph. Follows are one-directional and auto-accepted
-- (no request/approval flow) — privacy is controlled PER ACTIVITY via the
-- `visibility` column below, not per account. This mirrors Strava: you can
-- follow anyone, but each activity decides who actually sees it.

-- Public profile fields. `bio` is a short free-text blurb; name + image
-- already exist on next_auth.users (populated by Google/Strava OAuth).
-- `default_activity_visibility` is the visibility stamped on newly ingested /
-- synced activities so the user sets it once instead of per ride.
alter table if exists next_auth.users
  add column if not exists bio text;
alter table if exists next_auth.users
  add column if not exists default_activity_visibility text not null default 'followers'
    check (default_activity_visibility in ('public', 'followers', 'private'));

-- Per-activity visibility:
--   * public    — anyone, incl. logged-out via the public share link
--   * followers — the author's followers (and the author) only
--   * private   — the author only
-- Existing rows backfill to 'followers' (the not-null default). The owner
-- always sees their own activities regardless of this value; it only gates
-- what OTHER users see in feeds / on profiles / via share links.
alter table if exists public.activities
  add column if not exists visibility text not null default 'followers'
    check (visibility in ('public', 'followers', 'private'));
create index if not exists activities_visibility_date_idx
  on public.activities (visibility, start_date desc);

-- Follow graph. (follower_id) follows (following_id). Auto-accepted, so a
-- single row IS the relationship — no pending/accepted state.
create table if not exists public.follows (
  follower_id  uuid not null references next_auth.users(id) on delete cascade,
  following_id uuid not null references next_auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint follows_pkey primary key (follower_id, following_id),
  -- Can't follow yourself.
  constraint follows_no_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx  on public.follows (follower_id);
grant all on table public.follows to postgres;
grant all on table public.follows to service_role;

-- Likes (Strava "kudos"). One row per (activity, user).
create table if not exists public.activity_likes (
  activity_id bigint not null references public.activities(id) on delete cascade,
  user_id     uuid   not null references next_auth.users(id)   on delete cascade,
  created_at  timestamptz not null default now(),
  constraint activity_likes_pkey primary key (activity_id, user_id)
);
create index if not exists activity_likes_user_idx on public.activity_likes (user_id);
grant all on table public.activity_likes to postgres;
grant all on table public.activity_likes to service_role;

-- Comments. Flat thread (no replies) — mirrors Strava.
create table if not exists public.activity_comments (
  id          uuid primary key default uuid_generate_v4(),
  activity_id bigint not null references public.activities(id) on delete cascade,
  user_id     uuid   not null references next_auth.users(id)   on delete cascade,
  body        text   not null,
  created_at  timestamptz not null default now()
);
create index if not exists activity_comments_activity_idx
  on public.activity_comments (activity_id, created_at);
create index if not exists activity_comments_user_idx
  on public.activity_comments (user_id);
grant all on table public.activity_comments to postgres;
grant all on table public.activity_comments to service_role;

-- ── Push notifications: APNs device tokens ─────────────────────────────────
-- One row per (device) APNs token the user registered. We push to every token
-- a user has when someone likes / comments / follows them. `token` is unique so
-- a re-registration upserts. Cleared on delete-account cascade.
create table if not exists next_auth.device_tokens (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references next_auth.users(id) on delete cascade,
  token        text not null,
  platform     text not null default 'ios',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint device_tokens_token_unique unique (token)
);
create index if not exists device_tokens_user_idx on next_auth.device_tokens (user_id);
grant all on table next_auth.device_tokens to postgres;
grant all on table next_auth.device_tokens to service_role;

-- ── Performance telemetry ──────────────────────────────────────────────────
-- Real-user timing samples collected client-side: API round-trips (kind=api),
-- page navigation timing (kind=nav: ttfb/dcl/load), and web vitals
-- (kind=vital: lcp). `label` is a normalized route/metric (ids stripped) so we
-- can aggregate p50/p95 per endpoint on /admin/perf. High-volume, disposable —
-- prune old rows periodically; nothing FKs to it.
create table if not exists public.perf_samples (
  id         bigint generated always as identity primary key,
  kind       text not null,               -- 'api' | 'nav' | 'vital'
  label      text not null,               -- normalized route or metric name
  ms         double precision not null,   -- duration in milliseconds
  status     int,                         -- http status for api samples, else null
  user_id    uuid,                        -- viewer (nullable; not FK'd to keep inserts cheap)
  created_at timestamptz not null default now()
);
create index if not exists perf_samples_created_idx on public.perf_samples (created_at desc);
create index if not exists perf_samples_kind_label_idx on public.perf_samples (kind, label);
grant all on table public.perf_samples to postgres;
grant all on table public.perf_samples to service_role;

-- ── Feed denormalization: compact trace + speeds ───────────────────────────
-- The feed / profile cards only need a ~60-point mini-map trace and the two
-- speeds, but those lived inside the heavy `payload` jsonb (full GPS/HR/
-- altitude/speed streams). Selecting `payload->gps` forced Postgres to DETOAST
-- and parse the whole payload for every row → the feed p95 hit ~9 s.
--
-- These columns cache exactly what the cards need. A BEFORE INSERT/UPDATE
-- trigger fills them from `payload`, so no application write path has to change
-- and they can never drift. The feed then reads only light columns.
alter table public.activities add column if not exists trace         jsonb;
alter table public.activities add column if not exists avg_speed_kmh numeric(6,2);
alter table public.activities add column if not exists max_speed_kmh numeric(6,2);

create or replace function public.activities_denorm() returns trigger as $$
declare
  g    jsonb;
  n    int;
  step int;
  i    int;
  acc  jsonb := '[]'::jsonb;
begin
  -- Denorm must never block a write — swallow any malformed-payload error.
  begin
    g := NEW.payload -> 'gps';
    if g is not null and jsonb_typeof(g) = 'array' then
      n := jsonb_array_length(g);
      if n > 0 then
        step := greatest(1, ceil(n::numeric / 60)::int);
        i := 0;
        while i < n loop
          acc := acc || jsonb_build_array(g -> i);
          i := i + step;
        end loop;
        NEW.trace := acc;
      end if;
    end if;
    NEW.avg_speed_kmh := nullif(NEW.payload ->> 'avg_speed_kmh', '')::numeric;
    NEW.max_speed_kmh := nullif(NEW.payload ->> 'max_speed_kmh', '')::numeric;
  exception when others then
    null;
  end;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists activities_denorm_trg on public.activities;
create trigger activities_denorm_trg
  before insert or update on public.activities
  for each row execute function public.activities_denorm();

-- One-time backfill of existing rows (fires the trigger for each). Safe to
-- re-run; only touches rows not yet denormalized.
update public.activities set created_at = created_at where trace is null;

-- Feed query is `where user_id in (...) order by start_date desc limit 30`.
-- Without this composite index Postgres scans + sorts (feed select ~2s p95).
create index if not exists activities_user_start_idx
  on public.activities (user_id, start_date desc);

-- ── Activity media (photos, later videos) ──────────────────────────────────
-- User-added photos/videos on a ride, Strava-style. Files live in the public
-- `media` Storage bucket; this table holds the URLs + ordering. Owner-scoped
-- writes. Cascades when the activity's owner is deleted.
create table if not exists public.activity_media (
  id          uuid primary key default uuid_generate_v4(),
  activity_id bigint not null,
  user_id     uuid not null references next_auth.users(id) on delete cascade,
  url         text not null,
  kind        text not null default 'image',   -- 'image' | 'video'
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists activity_media_activity_idx on public.activity_media (activity_id, position);
grant all on table public.activity_media to postgres;
grant all on table public.activity_media to service_role;

-- SECURITY: the `media` bucket is PRIVATE. A public bucket meant every photo of
-- a followers-only / private ride was fetchable by anyone with the URL, forever
-- — bypassing the visibility model. We now keep only the object `path` and mint
-- short-lived signed URLs per request, after the viewer passes the same
-- visibility check as the activity. `url` is legacy (old public URLs) and is
-- kept nullable so new rows don't need it.
alter table public.activity_media add column if not exists path text;
update public.activity_media
   set path = split_part(url, '/object/public/media/', 2)
 where path is null and url like '%/object/public/media/%';
alter table public.activity_media alter column url drop not null;

-- Photo location (from EXIF / PHAsset) so a photo can be pinned on the ride's
-- map where it was taken. Null when the photo has no geotag.
alter table public.activity_media add column if not exists lat double precision;
alter table public.activity_media add column if not exists lng double precision;

-- ── Favorite places (itinerary start points) ───────────────────────────────
-- Saved addresses the user reuses as itinerary steps ("je pars toujours du même
-- endroit"). Stores a full BAN waypoint so it drops straight into the planner.
-- Per-user, synced across web + iOS.
create table if not exists public.favorite_places (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references next_auth.users(id) on delete cascade,
  name       text not null,
  label      text,
  code       text,
  postal     text,
  city       text,
  kind       text,
  lat        double precision not null,
  lng        double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists favorite_places_user_idx on public.favorite_places (user_id, created_at desc);
grant all on table public.favorite_places to postgres;
grant all on table public.favorite_places to service_role;
