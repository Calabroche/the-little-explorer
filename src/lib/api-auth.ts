/**
 * Auth resolver for API routes.
 *
 * Resolves the current user from either:
 *   1. NextAuth session cookie (web app)
 *   2. Authorization: Bearer <token> header (native iOS / watchOS app)
 *
 * Returns `{ id, email }` on success or `null` on failure. Callers
 * decide what status code to return — typically 401 when null.
 *
 * Bearer tokens are stored in `next_auth.api_tokens` (one row per
 * issued token, can be revoked). They're issued by the
 * /auth/native-done page after the user completes OAuth via
 * ASWebAuthenticationSession on a native client.
 *
 * Token format: 32 bytes of crypto random, base64url-encoded
 * (≈43 chars). Tokens are sensitive — never log them. Only their
 * sha256 hash is persisted (`api_tokens.token_hash`), so a DB dump
 * can't be replayed to impersonate anyone.
 */

import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from './auth';
import { supabaseAdmin } from './db';

export interface AuthedUser {
  id:    string;
  email: string | null;
}

/** sha256 hex of a bearer token — the only form we store / look up by. */
export function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Try the NextAuth session cookie first (most common path: browser).
 * If absent, look for an Authorization: Bearer token and resolve
 * the user via the api_tokens table.
 *
 * `req` is optional — only needed for the Bearer fallback. Server
 * components that don't have NextRequest (page.tsx) can pass null
 * and only get cookie-based auth.
 */
export async function getAuthedUser(req: NextRequest | null = null): Promise<AuthedUser | null> {
  // ── 1. NextAuth session cookie ─────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session: any = await getServerSession(buildAuthOptions());
  if (session?.user?.id) {
    return {
      id:    session.user.id as string,
      email: (session.user.email ?? null) as string | null,
    };
  }

  // ── 2. Bearer token ────────────────────────────────────────────
  const auth = req?.headers.get('authorization') ?? req?.headers.get('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+([\w\-_]+)$/);
  if (!m) return null;
  const token = m[1];
  // Bearer tokens are stored HASHED (sha256), never in clear: a database
  // leak/backup must not hand out replayable session tokens. The plaintext
  // only ever exists in the iOS Keychain and in the one-time redirect.
  const tokenHash = sha256(token);

  // Token lookup — service role bypasses RLS. Tokens that don't
  // exist or are revoked simply don't match here. Expired tokens
  // (expires_at < now) are filtered too; legacy tokens without
  // an expiry stay valid until they're rotated.
  const { data, error } = await supabaseAdmin()
    .schema('next_auth')
    .from('api_tokens')
    .select('user_id, revoked_at, expires_at, users:user_id(email)')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    console.error('[api-auth] token lookup failed:', error.message);
    return null;
  }
  if (!data) return null;

  // Expiry check — `expires_at` may be NULL for tokens issued before
  // the 90-day policy shipped; we treat those as non-expiring rather
  // than locking grandfathered iOS clients out.
  const exp = (data as { expires_at: string | null }).expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) {
    console.warn('[api-auth] token expired — refusing');
    return null;
  }

  // Optional: touch last_used_at so we know which tokens are stale.
  // Fire-and-forget — no need to await; if it fails the auth still works.
  supabaseAdmin()
    .schema('next_auth')
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .then(undefined, err => console.warn('[api-auth] last_used update failed:', err));

  return {
    id:    (data as { user_id: string }).user_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    email: ((data as any).users?.email ?? null) as string | null,
  };
}
