'use client';

/**
 * Public login page.
 *
 * Uses next-auth/react's `signIn()` helper instead of hand-rolling a
 * CSRF + POST form. The helper:
 *   - fetches /api/auth/csrf internally
 *   - POSTs to /api/auth/signin/<provider> with the token
 *   - follows the 302 to the provider's authorization URL
 *
 * Much simpler and avoids the timing race where the button was disabled
 * waiting for our manual CSRF fetch to complete.
 *
 * Errors in the URL (?error=OAuthCallback / OAuthCreateAccount / …) are
 * surfaced in a red banner so the user knows when something failed.
 */

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
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
  const [error, setError] = useState<string>('');
  const [busy, setBusy]   = useState<'' | 'google' | 'strava'>('');

  useEffect(() => {
    // Hydration smoke-test — if you don't see this in the console, React
    // never hydrated on /login and onClick can't fire.
    console.log('[login] hydrated, useEffect ran');
    document.title = 'TLE Login (hydrated)';
    const url = new URL(window.location.href);
    const err = url.searchParams.get('error');
    if (err) setError(err);
  }, []);

  const onClick = (provider: 'google' | 'strava') => {
    // Diagnostic logs — if you don't see "[login] click X" in the
    // console, the React onClick never fired (hydration broken).
    console.log(`[login] click ${provider}`);
    setBusy(provider);
    setError('');
    signIn(provider, { callbackUrl: '/' })
      .then(res => console.log('[login] signIn returned', res))
      .catch(err => {
        console.error('[login] signIn threw', err);
        setBusy('');
        setError('signIn failed: ' + (err?.message ?? 'unknown'));
      });
  };

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

        <button type="button" onClick={() => onClick('google')} disabled={busy !== ''} style={BUTTON}>
          <span style={{ fontSize: 16 }}>G</span>
          {busy === 'google' ? 'Connexion…' : 'Continuer avec Google'}
        </button>

        <div style={{ height: 12 }} />

        <button
          type="button"
          onClick={() => onClick('strava')}
          disabled={busy !== ''}
          style={{ ...BUTTON, background: '#FC4C02', color: '#fff', borderColor: '#FC4C02' }}
        >
          <span style={{ fontSize: 16, fontWeight: 800 }}>S</span>
          {busy === 'strava' ? 'Connexion…' : 'Continuer avec Strava'}
        </button>

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
