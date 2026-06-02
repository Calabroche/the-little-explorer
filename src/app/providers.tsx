'use client';

/**
 * Root client-side providers.
 *
 * Why SessionProvider here and not in layout.tsx directly:
 *   layout.tsx is a server component (uses Metadata, head children, etc.).
 *   SessionProvider is a client component — wrapping the whole tree in it
 *   means the layout must be marked 'use client', which loses the SEO /
 *   streaming benefits. Splitting it out is the canonical pattern in the
 *   NextAuth + Next.js 13 docs.
 *
 * LanguageProvider also moved here so we only have one client boundary.
 */

import { ReactNode, useEffect, useRef } from 'react';
import { SessionProvider, useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { LanguageProvider } from '@/i18n';

// Routes that must stay reachable without a valid session — never force
// a sign-out from these (it would loop on /login).
const PUBLIC_PREFIXES = ['/login', '/privacy', '/terms'];

/**
 * Forces a clean sign-out → /login the moment the session stops being
 * valid while the user is on a protected page.
 *
 * The trigger is `status === 'authenticated'` but `session.user.id`
 * missing: the JWT callback strips `uid` when the user's DB row is gone
 * (admin deletion) or their sessions were invalidated, which leaves the
 * cookie decodable (name/email survive) yet identity-less. Without this
 * the deleted user would sit on a half-broken UI until they happened to
 * navigate; here we actively eject them. `signOut` also clears the stale
 * cookie so middleware won't see it again.
 *
 * Paired with `refetchInterval` on SessionProvider so an idle tab still
 * gets ejected within ~a minute of the admin deleting the account.
 */
function AuthGuard() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (status === 'loading') return;  // session not resolved yet
    const isPublic = PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
    if (isPublic) return;
    // Invalid = no session at all, or a session whose identity was
    // stripped (uid gone after deletion / invalidation). Either way, on a
    // protected route, eject to /login. Covers both shapes NextAuth may
    // return after the jwt callback drops uid.
    const invalid = status === 'unauthenticated' || !session?.user?.id;
    if (invalid) {
      firedRef.current = true;
      void signOut({ callbackUrl: '/login' });
    }
  }, [status, session?.user?.id, pathname]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    // `refetchOnWindowFocus={false}` — NextAuth's default refetches the
    // session every time the browser tab regains focus. With a JWT
    // session strategy, the cookie doesn't change between requests, so
    // these refetches are pure overhead AND they change the session
    // object reference, which retriggers any useEffect downstream that
    // depends on `session` (in our case, the /api/activities loader).
    // Result before this flag: every Cmd-Tab triggered a full feed
    // reload spinner. Disabling fixes that.
    //
    // `refetchInterval={60}` — re-read /api/auth/session once a minute so
    // an admin-deleted / invalidated account is detected (the JWT callback
    // strips its uid) and AuthGuard can eject it even on an idle tab. The
    // downstream loaders key off stable primitives (sessionUserId), so a
    // same-uid refetch doesn't retrigger a feed reload.
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={60}>
      <AuthGuard />
      <LanguageProvider>{children}</LanguageProvider>
    </SessionProvider>
  );
}
