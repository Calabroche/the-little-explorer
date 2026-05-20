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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthOptions = any;

import { supabaseAdmin } from './db';

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
        scope:          'read,activity:read_all',
        approval_prompt: 'auto',
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
    callbacks: {
      /**
       * Fired after the OAuth flow returns. For Strava we use this hook to
       * persist the athlete_id + scope on the user row so the webhook can
       * later route incoming events back to the right user.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async signIn({ user, account, profile }: any) {
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
       * DB user id + athlete_id into the token. On every later request
       * only `token` is present, so we just return it unchanged.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async jwt({ token, user, account, profile }: any) {
        if (user) {
          token.uid = user.id;
        }
        if (account?.provider === 'strava' && profile?.id) {
          token.athleteId = Number(profile.id);
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
    // Quiet error-only logger. Errors still land in Vercel Functions logs;
    // we no longer flood prod with DEBUG_ENABLED noise on every request.
    logger: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error(code: string, ...message: any[]) {
        console.error(`[next-auth] ${code}`, JSON.stringify(message));
      },
    },
  };
}
