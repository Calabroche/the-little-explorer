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
 * Hand-rolled Strava OAuth2 provider. NextAuth's "OAuth2Provider" interface
 * is flexible enough; we just need to point it at Strava's endpoints and
 * map the non-standard response shape into NextAuth's user profile.
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
    // Strava returns the athlete inline with the token response, so there's
    // no separate userinfo call. We synthesise it from the token payload.
    userinfo: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async request({ tokens }: { tokens: any }) {
        return tokens.athlete ?? {};
      },
    },
    clientId:     process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile(athlete: any) {
      return {
        id:     String(athlete.id),
        name:   [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || athlete.username,
        email:  null, // Strava doesn't expose email in OAuth — we'll prompt the user later if needed
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
      }),
      stravaProvider(),
    ],
    session: { strategy: 'database' as const },
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
          await supabaseAdmin()
            .from('users')
            .update({ athlete_id: athleteId, strava_scope: account.scope ?? null })
            .eq('id', user.id);
        } catch (err) {
          console.error('[auth] failed to persist athlete_id:', err);
          // Don't block sign-in for a persistence hiccup — they can retry from settings.
        }
        return true;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async session({ session, user }: any) {
        if (session.user) {
          session.user.id = user.id;
          session.user.athleteId = user.athlete_id ?? null;
        }
        return session;
      },
    },
    pages: {
      signIn: '/login',
    },
  };
}
