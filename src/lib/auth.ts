/**
 * NextAuth configuration.
 *
 * Two providers:
 *
 *   1. Google OAuth — primary login. Free, fast, and the most users already
 *      have an account, so the friction-to-first-login is minimal.
 *
 *   2. Strava OAuth — secondary login AND the canonical way to connect a
 *      Strava athlete to our DB. Implemented as a hand-rolled OAuth2 provider
 *      because NextAuth doesn't ship one for Strava (Strava's spec deviates
 *      slightly: scope is comma-separated, athlete details live under
 *      `athlete.*` in the token response rather than via a separate
 *      userinfo endpoint).
 *
 * The Strava-specific bit — saving `athlete_id` + refresh token onto the
 * user — lives in the `signIn` callback below so that any login path
 * (initial OAuth, link from settings, re-auth after token expiry) hits
 * the same persistence code.
 *
 * Env required:
 *   NEXTAUTH_URL                — full origin (https://the-little-explorer-app.vercel.app)
 *   NEXTAUTH_SECRET             — `openssl rand -base64 32`
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET  (existing)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_JWT_SECRET         — from Supabase → Project Settings → API → JWT
 *
 * NOTE: this file imports lazily because the package isn't installed yet.
 * Once `npm install next-auth @auth/supabase-adapter @supabase/supabase-js`
 * is done the type errors here go away.
 */

// Polyfill WebSocket on Node < 22 BEFORE the supabase adapter pulls in
// supabase-js (which otherwise throws at construction on local dev).
import './polyfill-ws';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthOptions = any;

import { supabaseAdmin } from './db';
import { logEvent } from './events';

const STRAVA_AUTH_URL  = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

/**
 * Hand-rolled Strava OAuth2 provider.
 *
 * Strava deviates from the standard OAuth2 spec in a couple of ways that
 * NextAuth/openid-client trips over with default settings — this config
 * is the result of a debugging session where signin worked through
 * Strava's authorize page but failed with ?error=OAuthCallback on the
 * way back. Fixes baked in here:
 *
 *   - `client.token_endpoint_auth_method = 'client_secret_post'` —
 *     Strava expects the client_secret in the POST body of the token
 *     exchange, not as HTTP Basic auth (the openid-client default).
 *
 *   - `checks: ['state']` — Strava doesn't speak PKCE (it ignores the
 *     code_challenge and the matching code_verifier on token exchange
 *     comes back as "invalid"). Drop to plain state-based CSRF only.
 *
 *   - Real userinfo endpoint (`/api/v3/athlete`) instead of trying to
 *     extract `tokens.athlete` from the token response. openid-client
 *     strips non-standard fields, so the inline athlete object never
 *     made it through.
 */
function stravaProvider() {
  return {
    id:       'strava',
    name:     'Strava',
    type:     'oauth' as const,
    version:  '2.0',
    authorization: {
      url:    STRAVA_AUTH_URL,
      params: {
        // `activity:write` REMOVED — Strava requires manual
        // "Upload to Strava" approval to grant this scope. Without
        // approval their servers respond with a HARD 500 (not 401)
        // on every subsequent API call including /athlete, which
        // breaks OAuth sign-in entirely. Symptom: Vercel logs show
        // `OPError: expected 200 OK, got: 500 Internal Server
        // Error at BaseClient.userinfo` and the user sees
        // ?error=OAuthCallback. Re-add this scope once Strava
        // approves the upload tier; in the meantime
        // /api/strava/upload-activity will 403 on Watch rides and
        // the Watch app falls back to local-only ride storage.
        scope:          'read,activity:read_all',
        // Force the consent screen even for users who previously
        // authorized — Strava skips the prompt when scopes look
        // familiar, which would silently re-issue an out-of-date
        // token if we ever change scopes again.
        approval_prompt: 'force',
        response_type:  'code',
      },
    },
    token:    STRAVA_TOKEN_URL,
    userinfo: 'https://www.strava.com/api/v3/athlete',
    // Strava expects client_secret in the POST body, not in the
    // Authorization header. Without this NextAuth's token exchange
    // 400s with "invalid client".
    client: {
      token_endpoint_auth_method: 'client_secret_post' as const,
    },
    // Skip PKCE — Strava doesn't support it. Keep state-based CSRF.
    checks: ['state' as const],
    clientId:     process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile(athlete: any) {
      return {
        id:     String(athlete.id),
        name:   [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || athlete.username || `strava-${athlete.id}`,
        // Strava doesn't expose email on /api/v3/athlete. Synthesise a
        // unique placeholder so the Supabase adapter's UNIQUE(email)
        // constraint accepts the row. User can update later via a
        // settings page (not built yet).
        email:  `strava-${athlete.id}@strava.local`,
        image:  athlete.profile,
      };
    },
  };
}

export function buildAuthOptions(): AuthOptions {
  // Lazy require so this file is importable even before the deps are installed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const GoogleProvider = require('next-auth/providers/google').default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SupabaseAdapter } = require('@next-auth/supabase-adapter');

  return {
    adapter: SupabaseAdapter({
      url:        process.env.SUPABASE_URL!,
      secret:     process.env.SUPABASE_SERVICE_ROLE_KEY!,
    }),
    providers: [
      GoogleProvider({
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Force Google to always show the account picker, even when the
        // user is already signed into one Google account in the browser.
        // Without this, repeated visits auto-pick the same account and
        // there's no way to create a fresh TLE account from a different
        // Google identity, or to switch between accounts.
        authorization: {
          params: { prompt: 'select_account' },
        },
      }),
      stravaProvider(),
    ],
    // JWT strategy (not 'database') — so the session payload lives in the
    // cookie and the NextAuth middleware can decode it at the edge without
    // a DB roundtrip. Database strategy would force a Postgres call on
    // every request, which Edge runtime can't do (no fs/network in V8
    // isolates). The Supabase adapter is still used to PERSIST users +
    // accounts; only the session itself lives in the JWT now.
    session: { strategy: 'jwt' as const },
    secret:  process.env.NEXTAUTH_SECRET,
    // Trust the request's Host header rather than locking everything
    // to NEXTAUTH_URL. Vercel routinely surfaces the app under both
    // the production domain (the-little-explorer-app.vercel.app) AND
    // preview deployment URLs (PR-specific). Without trustHost,
    // NextAuth signs the OAuth state cookie for one host and refuses
    // it on the other, producing a phantom OAuthCallback error.
    trustHost: true,
    // Temporarily ON in prod while we hunt down a recurring
    // OAuthCallback on Strava sign-in. Drop back to NODE_ENV !==
    // 'production' once we have a stable diagnosis.
    debug: true,
    callbacks: {
      /**
       * Fired after the OAuth flow returns. For Strava we use this hook to
       * persist the athlete_id + scope on the user row so the webhook can
       * later route incoming events back to the right user.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async signIn({ user, account, profile }: any) {
        // Event log — fire-and-forget. We don't have NextRequest here,
        // so IP / user-agent are null. We distinguish signup (= first
        // sign-in for this user) from signin by checking whether the
        // user row has any prior signin event; the dashboard derives
        // signup count from "users whose first event is signin/signup".
        if (user?.id) {
          void logEvent({
            type: 'signin',
            userId: user.id,
            properties: { provider: account?.provider ?? 'unknown' },
          });
          // Best-effort: if this is the user's very first sign-in,
          // also log a `signup` event. We check by comparing the user
          // row's created_at to now — if it was created in the last
          // 60s, this signIn IS the one that minted the row.
          try {
            const { data } = await supabaseAdmin()
              .schema('next_auth')
              .from('users')
              .select('created_at')
              .eq('id', user.id)
              .maybeSingle();
            if (data?.created_at) {
              const ageMs = Date.now() - new Date(data.created_at as string).getTime();
              if (ageMs < 60_000) {
                void logEvent({
                  type: 'signup',
                  userId: user.id,
                  properties: { provider: account?.provider ?? 'unknown' },
                });
              }
            }
          } catch {
            // Best-effort — never block sign-in.
          }
        }

        if (account?.provider !== 'strava') return true;
        if (!user?.id) return true;

        const athleteId = profile?.id ? Number(profile.id) : null;
        if (!athleteId) return true;

        try {
          // Users live in the `next_auth` schema (where the adapter put them),
          // not in `public`. Without the .schema() call the update silently
          // misses and the webhook can't route Strava events to this user.
          await supabaseAdmin()
            .schema('next_auth')
            .from('users')
            .update({ athlete_id: athleteId, strava_scope: account.scope ?? null })
            .eq('id', user.id);
        } catch (err) {
          console.error('[auth] failed to persist athlete_id:', err);
          // Don't block sign-in for a persistence hiccup — they can retry from settings.
        }
        return true;
      },
      /**
       * Called whenever a JWT is created (sign-in) or read (subsequent
       * requests). On first sign-in, `user` is populated and we copy the
       * DB user id into the token. On every later request only `token`
       * is present, so we just return it unchanged.
       *
       * athleteId resolution: we set it on first sign-in regardless of
       * which provider was used. If the user signs in directly with
       * Strava, we get the id from `profile.id`. If they sign in with
       * Google but already have Strava linked, we query
       * next_auth.users.athlete_id to fill it in — otherwise the
       * sidebar's "+ CONNECTER STRAVA" button would re-appear on every
       * Google login (because session.user.athleteId would be null).
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async jwt({ token, user, account, profile }: any) {
        if (user) {
          token.uid = user.id;
          if (account?.provider === 'strava' && profile?.id) {
            token.athleteId = Number(profile.id);
          } else {
            // Google (or any other provider) sign-in for a user who may
            // already have Strava linked. Look up the stored athlete_id.
            try {
              const { data } = await supabaseAdmin()
                .schema('next_auth')
                .from('users')
                .select('athlete_id')
                .eq('id', user.id)
                .maybeSingle();
              token.athleteId = data?.athlete_id ?? null;
            } catch (err) {
              console.error('[auth] athlete_id lookup failed:', err);
              token.athleteId = null;
            }
          }
        }

        // "Logout from all devices" enforcement + onboarding state.
        // On every JWT read we make ONE DB call to fetch:
        //   * session_invalidated_at — if the token's iat predates it,
        //     we strip uid so the session callback below surfaces a
        //     null user and middleware redirects to /login.
        //   * onboarded_at — surfaced as `token.onboardedAt` so the
        //     Edge middleware can decide whether to redirect new users
        //     to /onboarding without its own DB roundtrip.
        //
        // Skipped on the very first call of a fresh sign-in (where
        // `user` is populated) — fields are written from `user` then.
        if (!user && token?.uid) {
          try {
            const { data, error } = await supabaseAdmin()
              .schema('next_auth')
              .from('users')
              .select('session_invalidated_at, onboarded_at, athlete_id')
              .eq('id', token.uid)
              .maybeSingle();

            // User row is GONE — an admin deleted this account from
            // /admin. Strip the identity so the session callback surfaces
            // a null user id: the middleware (authorized: !!token.uid)
            // refuses the next navigation and the client AuthGuard forces
            // a clean sign-out to /login. We act only on a genuine "no
            // row" (data null AND no error); a transient DB error leaves
            // the token untouched so a blip doesn't log everyone out.
            if (!error && data == null) {
              delete token.uid;
              delete token.athleteId;
              delete token.onboardedAt;
              return token;
            }

            const cutoff = data?.session_invalidated_at
              ? Math.floor(new Date(data.session_invalidated_at as string).getTime() / 1000)
              : 0;
            const iat = typeof token.iat === 'number' ? token.iat : 0;
            if (cutoff && iat && iat < cutoff) {
              delete token.uid;
              delete token.athleteId;
              delete token.onboardedAt;
            } else {
              // Refresh onboarding state on every read so the
              // middleware sees the latest value within one request
              // after /api/me/onboarding/complete fires.
              token.onboardedAt = data?.onboarded_at ?? null;
              // Also refresh athleteId on every read — critical for
              // the post-link flow: when a user goes through
              // /api/connect/strava and that custom endpoint writes
              // athlete_id directly to the DB (bypassing NextAuth's
              // user creation), the JWT in their cookie still says
              // null until they sign out/in. Re-reading here surfaces
              // the new value on the next request so the sidebar's
              // "+ Connecter Strava" button correctly disappears
              // without forcing a manual log out.
              if (data?.athlete_id != null) {
                token.athleteId = Number(data.athlete_id);
              }
            }
          } catch (err) {
            console.error('[auth] session/onboarded lookup failed:', err);
          }
        } else if (user) {
          // First-sign-in path — also seed onboardedAt so middleware
          // immediately knows whether to redirect.
          try {
            const { data } = await supabaseAdmin()
              .schema('next_auth')
              .from('users')
              .select('onboarded_at')
              .eq('id', user.id)
              .maybeSingle();
            token.onboardedAt = data?.onboarded_at ?? null;
          } catch {
            token.onboardedAt = null;
          }
        }
        return token;
      },
      /**
       * Surface the DB user id + athlete_id from the JWT into the session
       * object that client components see via useSession().
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async session({ session, token }: any) {
        if (session.user) {
          session.user.id        = token.uid       as string;
          session.user.athleteId = (token.athleteId as number) ?? null;
        }
        return session;
      },
    },
    pages: {
      signIn: '/login',
      // Send errors to the login page with the real error code in the URL
      // (?error=OAuthCallback / OAuthCreateAccount / Callback / …) so the
      // banner on /login can show a useful message.
      error:  '/login',
    },
    // Quiet error-only logger. We had verbose debug logging during the
    // Strava OAuth bring-up; once it stabilised we dropped back to
    // errors only so we don't flood Vercel Functions on every request.
    logger: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error(code: string, ...message: any[]) {
        const safe = message.map(m => {
          if (m instanceof Error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { name: m.name, message: m.message, stack: m.stack, cause: (m as any).cause };
          }
          return m;
        });
        console.error(`[next-auth] ${code}`, JSON.stringify(safe));
      },
    },
  };
}
