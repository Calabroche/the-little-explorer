'use client';

/**
 * /profil — full-page mobile profile screen.
 *
 * Web counterpart of the iOS Profile tab. On desktop the profile lives
 * in the sidebar's ProfileSection (bottom-left). On mobile the sidebar
 * collapses to a bottom nav bar with no room for that block, so this
 * dedicated route fills the gap.
 *
 * Layout: a single "Compte" card with avatar + email + Strava ID
 * (mirrors iOS), followed by the same action buttons we have on the
 * desktop ProfileSection (re-sync Strava, settings, admin, sign out).
 */

import { useCallback, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Link from 'next/link';
import { tokens } from '@/components/explorer/tokens';
import { isAdminEmail } from '@/lib/admin';

export default function ProfilPage() {
  const { data: session, status } = useSession();
  const [resyncState, setResyncState] = useState<'idle' | 'busy' | 'error'>('idle');
  /// Sub-phase shown on the button while the resync is running.
  /// Mirrors the desktop sidebar — "SYNCHRO ACTIVITÉS" while /sync
  /// is hitting Strava, then "CHARGEMENT TRACÉS x/y" while we loop
  /// /backfill-streams. Without this the mobile rider had no way to
  /// tell whether their click did anything.
  const [phase, setPhase]                 = useState<'syncing' | 'streaming' | null>(null);
  const [streamProgress, setStreamProgress] = useState<{ done: number; total: number } | null>(null);

  const resync = useCallback(async () => {
    if (resyncState === 'busy') return;
    setResyncState('busy');
    setPhase('syncing');
    setStreamProgress(null);
    // Engagement beacon — server debounces to 1/hour per user. Same
    // event type as the sidebar's button so the funnel groups them.
    void fetch('/api/me/track', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event: 'manual_resync', props: { surface: 'profil' } }),
    }).catch(() => { /* best-effort */ });
    try {
      const r = await fetch('/api/strava/sync', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      // Chain the streams backfill so the mobile rider gets maps +
      // charts in one click, same as the desktop "RE-SYNCER STRAVA"
      // button does. Without this, /profil's resync used to fetch
      // summaries only, leaving every activity detail page with
      // blank chart cards until the rider found the desktop sidebar
      // button — which doesn't exist on mobile.
      setPhase('streaming');
      let totalProcessed = 0;
      let initialRemaining: number | null = null;
      for (let i = 0; i < 50; i++) {
        const rr = await fetch('/api/strava/backfill-streams', { method: 'POST' });
        if (!rr.ok) break;  // soft-fail — the summaries are saved, charts can come later
        const d = await rr.json() as { processed: number; remaining: number; done: boolean };
        totalProcessed += d.processed;
        if (initialRemaining == null) initialRemaining = totalProcessed + d.remaining;
        setStreamProgress({ done: totalProcessed, total: initialRemaining });
        if (d.done || (d.processed === 0 && d.remaining === 0)) break;
      }

      // Full reload so /api/activities re-fetches with the freshly
      // inserted rows. Matches the desktop ProfileSection behaviour.
      window.location.href = '/';
    } catch (err) {
      console.error('[resync] failed:', err);
      setResyncState('error');
    } finally {
      setPhase(null);
    }
  }, [resyncState]);

  if (status === 'loading') {
    return (
      <main style={pageStyle}>
        <p style={{ color: tokens.inkLight, fontFamily: "'Space Grotesk'" }}>Chargement…</p>
      </main>
    );
  }

  if (status !== 'authenticated' || !session?.user) {
    return (
      <main style={pageStyle}>
        <p style={{ color: tokens.inkLight, fontFamily: "'Space Grotesk'" }}>
          Pas connecté. <Link href="/login" style={{ color: tokens.terra }}>Aller à la page de connexion</Link>.
        </p>
      </main>
    );
  }

  const u = session.user;
  const displayName = u.name || u.email || 'Account';
  const initials = (u.name || u.email || '?')
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const athleteId = (u as any).athleteId as number | null | undefined;
  const stravaLinked = Boolean(athleteId);

  return (
    <main style={pageStyle}>
      <div style={pageInner}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{
            fontFamily: "'Playfair Display'",
            fontSize:   28,
            fontWeight: 800,
            color:      tokens.ink,
            margin:     0,
          }}>
            Profil
          </h1>
          <Link href="/" style={{
            padding: '6px 14px',
            background: tokens.surface,
            border: `1px solid ${tokens.creamBorder}`,
            borderRadius: 3,
            color: tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.04em',
            textDecoration: 'none',
          }}>
            ← APP
          </Link>
        </div>

        {/* ─── Account card ──────────────────────────────────────── */}
        <div style={cardStyle}>
          {/* User row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            {u.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.image} alt="" width={48} height={48} style={{ borderRadius: '50%', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                background: tokens.terra, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Space Grotesk'", fontSize: 16, fontWeight: 700,
              }}>{initials}</div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontFamily: "'Space Grotesk'", fontSize: 15, fontWeight: 600,
                color: tokens.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{displayName}</div>
              {u.email && (
                <div style={{
                  fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{u.email}</div>
              )}
              {stravaLinked && (
                <div style={{
                  fontFamily: 'monospace', fontSize: 11, color: '#FC4C02',
                  marginTop: 2,
                }}>
                  ⚡ Strava · {athleteId}
                </div>
              )}
            </div>
          </div>

          {/* Connect-Strava CTA when not linked */}
          {!stravaLinked && (
            <button
              // Custom link-account endpoint, not NextAuth's signIn —
              // user is already authed (otherwise they couldn't see
              // /profil), so we ATTACH Strava to the current row
              // instead of letting NextAuth fork a new user.
              onClick={() => { window.location.href = '/api/connect/strava/start'; }}
              style={{
                ...buttonStyle,
                background: '#FC4C02',
                border: '1px solid #FC4C02',
                color: '#fff',
              }}
            >
              + CONNECTER STRAVA
            </button>
          )}

          {/* Re-sync Strava (only when linked) */}
          {stravaLinked && (
            <button
              onClick={resync}
              disabled={resyncState === 'busy'}
              style={{
                ...buttonStyle,
                background:  resyncState === 'error' ? '#FEE' : tokens.creamDark,
                border:      `1px solid ${resyncState === 'error' ? '#FCC' : tokens.creamBorder}`,
                color:       resyncState === 'error' ? '#A00' : tokens.inkMid,
                cursor:      resyncState === 'busy' ? 'wait' : 'pointer',
              }}
            >
              {resyncState === 'busy' && phase === 'syncing'
                ? 'SYNCHRO ACTIVITÉS…'
                : resyncState === 'busy' && phase === 'streaming' && streamProgress
                  ? `CHARGEMENT TRACÉS ${streamProgress.done}/${streamProgress.total}…`
                  : resyncState === 'busy'
                    ? 'SYNCHRO…'
                    : resyncState === 'error'
                      ? '✗ ÉCHEC — RÉESSAYER'
                      : '↻ RE-SYNCER STRAVA'}
            </button>
          )}

          {/* Settings */}
          <Link
            href="/settings"
            style={{
              ...buttonStyle,
              background: tokens.creamDark,
              border: `1px solid ${tokens.creamBorder}`,
              color: tokens.inkMid,
              textDecoration: 'none',
              textAlign: 'center',
              display: 'block',
            }}
          >
            ⚙ PARAMÈTRES
          </Link>

          {/* Admin (allowlist only) */}
          {isAdminEmail(u.email) && (
            <Link
              href="/admin"
              style={{
                ...buttonStyle,
                background: tokens.creamDark,
                border: `1px dashed ${tokens.creamBorder}`,
                color: tokens.inkMid,
                textDecoration: 'none',
                textAlign: 'center',
                display: 'block',
              }}
            >
              ⚙ ADMIN
            </Link>
          )}

          {/* Sign out — destructive, last */}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{
              ...buttonStyle,
              background: tokens.surface,
              border: `1px solid ${tokens.creamBorder}`,
              color: tokens.inkMid,
            }}
          >
            SE DÉCONNECTER
          </button>
        </div>
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  // body { overflow: hidden } in globals.css → page needs its own
  // scroll context, not just minHeight (which gets clipped).
  height:      '100dvh',
  overflowY:   'auto',
  padding:     '40px 16px 40px',
  background:  tokens.cream,
};

const pageInner: React.CSSProperties = {
  maxWidth:    520,
  margin:      '0 auto',
};

const cardStyle: React.CSSProperties = {
  background:   tokens.surface,
  border:       `1px solid ${tokens.creamBorder}`,
  borderRadius: 6,
  padding:      16,
  display:      'flex',
  flexDirection: 'column',
  gap:          8,
};

const buttonStyle: React.CSSProperties = {
  width:         '100%',
  padding:       '11px 12px',
  borderRadius:  3,
  fontFamily:    "'Space Grotesk'",
  fontSize:      12,
  fontWeight:    700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor:        'pointer',
  boxSizing:     'border-box',
};
