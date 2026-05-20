/**
 * /auth/native-done — handoff page for native clients (iOS, watchOS).
 *
 * Flow:
 *   1. Native app opens ASWebAuthenticationSession to
 *      `https://the-little-explorer-app.vercel.app/login?callbackUrl=/auth/native-done`
 *   2. User signs in via Google or Strava
 *   3. NextAuth redirects to /auth/native-done with a valid session cookie
 *   4. THIS page (server component) reads the session, issues a long-lived
 *      bearer token in next_auth.api_tokens, and redirects to a custom
 *      URL scheme: `littleexplorer://auth/done?token=<token>`
 *   5. iOS captures the redirect via ASWebAuthenticationSession's
 *      completionHandler, extracts the token, stores in Keychain
 *
 * Token generation: 32 bytes crypto random, base64url-encoded. The
 * token is sent ONCE through the redirect; we never expose it again
 * (the native app must persist it on first delivery).
 *
 * Label heuristic: we tag the token with the User-Agent so the user
 * can later identify it from the /settings tokens list ("iPhone 14
 * Pro" / "iPad Air"). User can rename it via the settings UI.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { randomBytes } from 'crypto';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Custom URL scheme registered on iOS (set in project.yml under
// CFBundleURLSchemes). Match exactly.
const NATIVE_SCHEME = 'littleexplorer';

function deriveLabel(userAgent: string): string {
  // ASWebAuthenticationSession sends "Mozilla/5.0 (iPhone; …)". Try
  // to extract a friendly device name; fall back to the raw UA.
  const m = userAgent.match(/\(([^)]+)\)/);
  if (!m) return userAgent.slice(0, 60);
  // Take the first segment ("iPhone; CPU iPhone OS 17_5 like Mac OS X" → "iPhone")
  return (m[1].split(';')[0] || userAgent).trim().slice(0, 60);
}

export default async function NativeDonePage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session: any = await getServerSession(buildAuthOptions());
  if (!session?.user?.id) {
    // User landed here without a valid session — bounce back to /login.
    redirect('/login');
  }

  // 32 random bytes base64url-encoded = 43 chars, ~256 bits of entropy.
  const token = randomBytes(32).toString('base64url');

  // Persist. If it fails, we redirect to the app with an error so it
  // can surface something useful instead of hanging on the auth screen.
  const ua = headers().get('user-agent') ?? '';
  const label = deriveLabel(ua);

  const { error } = await supabaseAdmin()
    .schema('next_auth')
    .from('api_tokens')
    .insert({
      user_id: session.user.id,
      token,
      label,
    });

  if (error) {
    console.error('[native-done] insert failed:', error.message);
    redirect(`${NATIVE_SCHEME}://auth/done?error=token_issue_failed`);
  }

  redirect(`${NATIVE_SCHEME}://auth/done?token=${encodeURIComponent(token)}`);
}
