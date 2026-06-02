'use client';

/**
 * /admin — admin dashboard.
 *
 * Lists every TLE user with their email, provider linkage (Google
 * and/or Strava), activity count and join date. Only the email
 * allowlist in src/lib/admin.ts can hit this page; everyone else
 * sees a 403-ish message because /api/admin/users gates them.
 *
 * Client component because the table is small and refreshes on demand;
 * doing it server-side would mean a fresh full page load on each
 * refresh click, which is overkill here.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/components/explorer/tokens';

interface AdminUser {
  id:         string;
  email:      string | null;
  name:       string | null;
  image:      string | null;
  athleteId:  number | null;
  // Null on rows that pre-date the created_at ALTER TABLE migration.
  createdAt:  string | null;
  activities: number;
  providers:  string[];
}

const CARD: React.CSSProperties = {
  background: tokens.surface,
  border:     `1px solid ${tokens.creamBorder}`,
  borderRadius: 4,
  padding:    24,
  maxWidth:   1080,
  margin:     '0 auto',
};

const TH: React.CSSProperties = {
  textAlign:    'left',
  padding:      '10px 12px',
  fontFamily:   "'Space Grotesk'",
  fontSize:     11,
  fontWeight:   700,
  letterSpacing: '0.06em',
  color:        tokens.inkLight,
  textTransform: 'uppercase',
  borderBottom: `1px solid ${tokens.creamBorder}`,
  whiteSpace:   'nowrap',
};

const TD: React.CSSProperties = {
  padding:    '10px 12px',
  fontFamily: "'Space Grotesk'",
  fontSize:   13,
  color:      tokens.ink,
  borderBottom: `1px solid ${tokens.creamBorder}`,
  verticalAlign: 'middle',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display:     'inline-block',
      padding:     '2px 8px',
      marginRight: 4,
      fontFamily:  "'Space Grotesk'",
      fontSize:    10,
      fontWeight:  700,
      letterSpacing: '0.04em',
      color:       '#fff',
      background:  color,
      borderRadius: 3,
      textTransform: 'uppercase',
    }}>{label}</span>
  );
}

export default function AdminPage() {
  const [users, setUsers]     = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  /// Which user is currently being deleted — keyed by id so the button
  /// on that specific row can show a spinner state while we wait for
  /// the request. Cleared on success / failure.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/users')
      .then(async r => {
        if (r.status === 403) throw new Error('Accès refusé — tu n\'es pas dans l\'allowlist admin.');
        if (r.status === 401) throw new Error('Pas connecté.');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ users: AdminUser[] }>;
      })
      .then(d => setUsers(d.users ?? []))
      .catch(e => setError(e.message ?? 'Erreur inconnue'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  /// Confirmation + DELETE call. Two warnings before the actual
  /// destructive op so we don't fat-finger Hélena out of existence.
  /// On success, drop the row from the local state immediately
  /// (no full refresh round-trip).
  const deleteUser = async (u: AdminUser) => {
    const summary = `${u.name ?? u.email ?? u.id} · ${u.activities} activités`;
    if (!confirm(
      `⚠️ Supprimer définitivement ${summary} ?\n\n` +
      `Tout sera effacé : compte, sessions, providers (Google/Strava), activités, ` +
      `bikes, carnet d'entretien, itinéraires. Cette action est irréversible. ` +
      `Côté Strava, l'autorisation reste active (la personne peut la révoquer ` +
      `manuellement sur strava.com/settings/apps).`,
    )) return;
    setDeletingId(u.id);
    try {
      const r = await fetch('/api/admin/users', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: u.id }),
      });
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try {
          const body = await r.json() as { error?: string; detail?: string };
          if (body?.error) detail = body.detail ? `${body.error}: ${body.detail}` : body.error;
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      // Optimistic local update — strip the row.
      setUsers(prev => prev.filter(x => x.id !== u.id));
    } catch (err) {
      alert(`Échec de la suppression : ${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    // `body { overflow: hidden }` in globals.css clamps the page —
    // give <main> its own scroll context or it can't reach the
    // table rows below the fold.
    <main style={{
      height:     '100vh',
      overflowY:  'auto',
      padding:    '40px 24px',
      background: tokens.cream,
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{
          fontFamily: "'Playfair Display'",
          fontSize:   28,
          fontWeight: 800,
          color:      tokens.ink,
          margin:     0,
        }}>
          Admin · Users
        </h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/admin/metrics" style={{
            padding: '6px 14px',
            background: tokens.terra,
            border: `1px solid ${tokens.terra}`,
            borderRadius: 3,
            color: '#fff',
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
            letterSpacing: '0.04em',
            textDecoration: 'none',
          }}>
            MÉTRIQUES →
          </Link>
          <button onClick={refresh} disabled={loading} style={{
            padding: '6px 14px',
            background: tokens.creamDark,
            border: `1px solid ${tokens.creamBorder}`,
            borderRadius: 3,
            color: tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.04em',
            cursor: loading ? 'wait' : 'pointer',
          }}>
            {loading ? '…' : 'RAFRAÎCHIR'}
          </button>
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
      </div>

      <div style={CARD}>
        {error && (
          <div style={{
            padding: '12px 14px',
            background: '#FEE',
            border: '1px solid #FCC',
            borderRadius: 4,
            color: '#A00',
            fontFamily: "'Space Grotesk'", fontSize: 13,
            marginBottom: 16,
          }}>{error}</div>
        )}

        {!error && (
          <>
            <div style={{
              fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkLight,
              marginBottom: 16,
            }}>
              {loading ? 'Chargement…' : `${users.length} utilisateur${users.length > 1 ? 's' : ''}`}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={TH}>User</th>
                    <th style={TH}>Email</th>
                    <th style={TH}>Providers</th>
                    <th style={TH}>Strava ID</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Activités</th>
                    <th style={TH}>Inscrit</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {u.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={u.image} alt="" width={28} height={28} style={{ borderRadius: '50%', flexShrink: 0 }} />
                          ) : (
                            <div style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: tokens.terra, color: '#fff', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 700,
                            }}>
                              {(u.name ?? u.email ?? '?').slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <span style={{ fontWeight: 600 }}>{u.name ?? '—'}</span>
                            {/* Click the UUID to copy — saves opening dev
                                tools when admin needs the id for the
                                debug endpoints (list-user-activities /
                                strava-streams-probe). Title attr shows the
                                full uuid on hover. */}
                            <code
                              onClick={() => {
                                navigator.clipboard?.writeText(u.id);
                              }}
                              title={`Cliquer pour copier — ${u.id}`}
                              style={{
                                fontSize: 10, color: tokens.inkLight,
                                fontFamily: 'monospace',
                                cursor: 'pointer',
                                userSelect: 'all',
                              }}
                            >
                              {u.id.slice(0, 8)}…{u.id.slice(-4)}
                            </code>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...TD, color: tokens.inkMid, fontSize: 12 }}>{u.email ?? '—'}</td>
                      <td style={TD}>
                        {u.providers.includes('google') && <Badge label="Google" color="#4285F4" />}
                        {u.providers.includes('strava') && <Badge label="Strava" color="#FC4C02" />}
                        {u.providers.length === 0 && <span style={{ color: tokens.inkLight, fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11, color: tokens.inkMid }}>
                        {u.athleteId ?? <span style={{ color: tokens.inkLight }}>—</span>}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        {u.activities}
                      </td>
                      <td style={{ ...TD, color: tokens.inkMid, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {formatDate(u.createdAt)}
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <button
                          onClick={() => deleteUser(u)}
                          disabled={deletingId === u.id}
                          title="Supprimer définitivement ce compte (cascade sur toutes ses données)"
                          style={{
                            padding: '4px 10px',
                            background:   deletingId === u.id ? '#FCC' : 'transparent',
                            border:       `1px solid ${deletingId === u.id ? '#A00' : '#E5B4B4'}`,
                            borderRadius: 3,
                            color:        '#A00',
                            fontFamily:   "'Space Grotesk'",
                            fontSize:     11,
                            fontWeight:   600,
                            cursor:       deletingId === u.id ? 'wait' : 'pointer',
                            opacity:      deletingId === u.id ? 0.6 : 1,
                            whiteSpace:   'nowrap',
                          }}
                        >
                          {deletingId === u.id ? '…' : '✗ Supprimer'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
