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

import { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { LanguageProvider } from '@/i18n';

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
    <SessionProvider refetchOnWindowFocus={false}>
      <LanguageProvider>{children}</LanguageProvider>
    </SessionProvider>
  );
}
