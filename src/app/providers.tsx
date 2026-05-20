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
    <SessionProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </SessionProvider>
  );
}
