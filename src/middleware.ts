/**
 * Auth gate: redirect unauthenticated users to /login.
 *
 * Runs on every request before Next.js routes anything. Uses NextAuth's
 * built-in `withAuth` helper, which:
 *   - reads the session cookie (works in Edge runtime, no DB call)
 *   - lets the request through if a session token is present
 *   - redirects to `pages.signIn` (= '/login') otherwise
 *
 * The `matcher` excludes routes that must remain public so we don't
 * trap users in a redirect loop:
 *   - /login           — the login page itself
 *   - /api/auth/*      — NextAuth's own endpoints (signin/callback/csrf/…)
 *   - /_next/*         — Next.js assets
 *   - /favicon.*       — favicon and PWA icons
 *
 * Public API routes (currently /api/activities, /api/commune-search,
 * /api/elevation, /api/route-bike, /api/strava-webhook) are also
 * excluded for now — they'll be session-locked in Stage 2 once the
 * activities table is the source of truth. Until then, the existing
 * JSON-file code path still serves Florian + Helena.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAuth } = require('next-auth/middleware');

export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - /login                  (public login page)
     *  - /privacy + /terms       (public legal pages — required by Google
     *                             OAuth verification and by the Strava API
     *                             Agreement; linked from /login + footer)
     *  - /api/*                  (all API routes — session check happens in handlers)
     *  - /_next/*                (Next.js internals)
     *  - /favicon.* + /logo.*    (PWA icons + favicon)
     */
    '/((?!api|login|privacy|terms|_next|favicon|logo|.*\\.).*)',
  ],
};
