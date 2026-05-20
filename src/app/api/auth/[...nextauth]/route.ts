/**
 * NextAuth catch-all route — handles every endpoint under /api/auth/* :
 *   /api/auth/signin
 *   /api/auth/callback/google
 *   /api/auth/callback/strava
 *   /api/auth/session
 *   /api/auth/signout
 *   …
 *
 * Lazy-instantiation note: the SupabaseAdapter constructor throws when
 * SUPABASE_URL is missing. If we instantiated NextAuth at module-load time
 * the production build would fail (Next collects page data during build,
 * which executes module top-level code). So we build the handler on first
 * request instead, after the env has been loaded.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildAuthOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _handler: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(): any {
  if (_handler) return _handler;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const NextAuth = require('next-auth').default;
  _handler = NextAuth(buildAuthOptions());
  return _handler;
}

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: 'auth_not_configured', message: 'Supabase + OAuth env not set yet.' },
    { status: 503 },
  );
}

export async function GET(req: NextRequest, ctx: unknown) {
  if (!process.env.SUPABASE_URL || !process.env.NEXTAUTH_SECRET) return notConfigured();
  return getHandler()(req, ctx);
}

export async function POST(req: NextRequest, ctx: unknown) {
  if (!process.env.SUPABASE_URL || !process.env.NEXTAUTH_SECRET) return notConfigured();
  return getHandler()(req, ctx);
}
