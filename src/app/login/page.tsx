'use client';

/**
 * Public login page.
 *
 * Why POST forms instead of `<a href>` to /api/auth/signin/<provider> :
 * NextAuth v4's signin route only redirects to the OAuth provider when the
 * request is a POST with a valid CSRF token. A GET silently 302's back to
 * /login?error=<provider> (the generic fallback) — which is exactly the
 * bug we hit on the first attempt.
 *
 * We fetch the CSRF token on mount and inject it into two hidden forms,
 * one per provider. Submitting the form does the POST + cookie roundtrip
 * that NextAuth expects.
 */

import { useEffect, useRef, useState } from 'react';
import { tokens } from '@/components/explorer/tokens';

const CARD: React.CSSProperties = {
  background: tokens.surface,
  border:     `1px solid ${tokens.creamBorder}`,
  borderRadius: 4,
  padding:    32,
  maxWidth:   420,
  width:      '100%',
};

const BUTTON: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            10,
  width:          '100%',
  padding:        '14px 18px',
  border:         `1px solid ${tokens.creamBorder}`,
  borderRadius:   4,
  background:     tokens.cream,
  color:          tokens.ink,
  fontFamily:     "'Space Grotesk'",
  fontSize:       14,
  fontWeight:     600,
  cursor:         'pointer',
  textDecoration: 'none',
  transition:     'background 120ms ease',
};

export default function LoginPage() {
  const [csrf, setCsrf]     = useState<string>('');
  const [error, setError]   = useState<string>('');
  const callbackRef         = useRef<string>('https://the-little-explorer-app.vercel.app');

  useEffect(() => {
    fetch('/api/auth/csrf', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { csrfToken?: string }) => setCsrf(d.csrfToken ?? ''))
      .catch(() => setCsrf(''));

    // Surface the real NextAuth error code if the URL has one
    const url = new URL(window.location.href);
    const err = url.searchParams.get('error');
    if (err) setError(err);
    callbackRef.current = window.location.origin;
  }, []);

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      background: tokens.cream,
    }}>
      <div style={CARD}>
        <h1 style={{
          fontFamily: "'Playfair Display'",
          fontSize: 28, fontWeight: 800,
          color: tokens.ink,
          marginBottom: 8,
        }}>
          The Little Explorer
        </h1>
        <p style={{
          fontFamily: "'Space Grotesk'",
          fontSize: 13, color: tokens.inkLight,
          marginBottom: 28,
          lineHeight: 1.5,
        }}>
          Connecte-toi pour retrouver tes sorties Strava, ton calendrier
          d&apos;activités et tes objectifs.
        </p>

        {error && (
          <div style={{
            padding: '10px 12px',
            marginBottom: 16,
            background: '#FEE',
            border: '1px solid #FCC',
            borderRadius: 4,
            fontFamily: "'Space Grotesk'",
            fontSize: 12,
            color: '#A00',
          }}>
            Erreur de connexion : <code style={{ fontWeight: 700 }}>{error}</code>
          </div>
        )}

        <form method="POST" action="/api/auth/signin/google">
          <input type="hidden" name="csrfToken"   value={csrf} />
          <input type="hidden" name="callbackUrl" value={callbackRef.current} />
          <button type="submit" style={BUTTON} disabled={!csrf}>
            <span style={{ fontSize: 16 }}>G</span>
            Continuer avec Google
          </button>
        </form>

        <div style={{ height: 12 }} />

        <form method="POST" action="/api/auth/signin/strava">
          <input type="hidden" name="csrfToken"   value={csrf} />
          <input type="hidden" name="callbackUrl" value={callbackRef.current} />
          <button
            type="submit"
            disabled={!csrf}
            style={{ ...BUTTON, background: '#FC4C02', color: '#fff', borderColor: '#FC4C02' }}
          >
            <span style={{ fontSize: 16, fontWeight: 800 }}>S</span>
            Continuer avec Strava
          </button>
        </form>

        <p style={{
          marginTop: 24,
          fontFamily: "'Space Grotesk'",
          fontSize: 11, color: tokens.inkLight,
          lineHeight: 1.5,
        }}>
          En continuant, tu acceptes que nous récupérions tes activités
          Strava via l&apos;API officielle. Aucun mot de passe stocké.
        </p>
      </div>
    </main>
  );
}
