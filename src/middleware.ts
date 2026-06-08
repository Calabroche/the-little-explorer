/**
 * Auth gate + onboarding redirect.
 *
 * Two responsibilities:
 *
 *   1. Auth gate (NextAuth's withAuth): if no session cookie, redirect
 *      to /login. Handled implicitly by withAuth on every matched path.
 *
 *   2. Onboarding gate (custom): if the signed-in user hasn't completed
 *      the 3-step /onboarding flow, redirect them there. The JWT carries
 *      `onboardedAt` (populated by the jwt callback in lib/auth.ts) so
 *      this check is done at the Edge without a DB roundtrip.
 *
 * The middleware runs on every page route except:
 *   - /login                  (public sign-in page)
 *   - /privacy, /terms        (public legal pages)
 *   - /api/*                  (per-handler auth instead)
 *   - /_next, /favicon, /logo (assets)
 *
 * /onboarding itself IS matched (must be signed in to reach it) but
 * we explicitly skip the onboarding-redirect when already on it, to
 * avoid a redirect loop.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAuth } = require('next-auth/middleware');

// Pages that should be reachable without completing onboarding first.
// Apart from /onboarding itself:
//   - /admin/* — admin pages don't get gated
//   - /api/*   — auth-side, never user-facing
//   - /auth/*  — includes /auth/native-done, the iOS bearer-token
//                handoff. Without this the iOS sign-in flow would
//                redirect into /onboarding in the ASWebAuthenticationSession
//                webview instead of bouncing back to the native app.
// /guide is whitelisted so the "Voir le guide complet" link on the
// onboarding welcome screen (Step 0) actually opens — without it the
// onboarding gate bounces a not-yet-onboarded user straight back to
// /onboarding and the link appears to do nothing.
const ONBOARDING_BYPASS = new Set<string>(['/onboarding', '/guide']);
const ONBOARDING_BYPASS_PREFIX = ['/admin', '/api', '/auth'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withAuth(
  function middleware(req: NextRequest & { nextauth: { token: any } }) {
    const token = req.nextauth?.token;
    if (!token) return; // withAuth already handled the unauth → /login redirect

    const path = req.nextUrl.pathname;
    const isOnboarded = Boolean(token.onboardedAt);

    if (isOnboarded) return;
    if (ONBOARDING_BYPASS.has(path)) return;
    if (ONBOARDING_BYPASS_PREFIX.some(prefix => path.startsWith(prefix))) return;

    // Not onboarded + not on a bypass route → send to the welcome
    // guide. /guide?welcome=1 shows a hello banner + CTA "Commencer"
    // that routes to /onboarding; without ?welcome=1 the regular guide
    // renders (used by the "Voir le guide complet" link on the
    // onboarding welcome screen). Once onboarded_at is set, the user
    // never lands here again because this whole branch is gated by
    // `!isOnboarded`.
    //
    // We preserve the original path as `from` so the welcome page —
    // and downstream /onboarding — can bounce them back where they
    // were trying to go.
    const url = req.nextUrl.clone();
    url.pathname = '/guide';
    url.searchParams.set('welcome', '1');
    url.searchParams.set('from', path);
    return NextResponse.redirect(url);
  },
  {
    pages: { signIn: '/login' },
    callbacks: {
      // A valid session always carries `uid` (set in the jwt callback on
      // sign-in). When an admin deletes a user, that same callback strips
      // `uid` on the next session read — so a token without `uid` means a
      // deleted / invalidated account. Treat it as unauthenticated so
      // withAuth bounces it to /login instead of letting the stale cookie
      // through. (Default `authorized` is just `!!token`, which would
      // wave a uid-less token straight in.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authorized: ({ token }: { token: any }) => Boolean(token?.uid),
    },
  },
);

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - /login                  (public login page)
     *  - /privacy + /terms       (public legal pages — Strava + Google compliance)
     *  - /api/*                  (handler-side auth)
     *  - /_next/*                (Next.js internals)
     *  - /favicon.* + /logo.*    (assets)
     */
    '/((?!api|login|privacy|terms|_next|favicon|logo|.*\\.).*)',
  ],
};
