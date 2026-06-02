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
    // cards below the fold. Reduced horizontal padding on phones
    // so the cards aren't squashed into 60% of the screen.
    <main style={{
      height:     '100vh',
      overflowY:  'auto',
      padding:    '24px 16px',
      background: tokens.cream,
    }}>
      {/* Scoped media-query block — keeps the responsive logic
          inline with the component instead of polluting globals.css
          for an admin-only page. */}
      <style>{`
        .tle-admin-title { font-size: 22px; }
        .tle-admin-header { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
        .tle-admin-header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .tle-admin-userrow { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 768px) {
          .tle-admin-title { font-size: 28px; }
          .tle-admin-header { flex-direction: row; align-items: baseline; justify-content: space-between; }
          .tle-admin-userrow {
            grid-template-columns:
              minmax(0, 1.8fr)      /* identity (avatar + name + uuid) */
              minmax(0, 1.6fr)      /* email */
              auto                   /* providers */
              auto                   /* strava id */
              auto                   /* activity count */
              auto                   /* date */
              auto;                  /* delete button */
            align-items: center;
            gap: 16px;
          }
          .tle-admin-meta-label { display: none !important; }
        }
      `}</style>

      <div className="tle-admin-header" style={{ maxWidth: 1080, margin: '0 auto 16px' }}>
        <h1 className="tle-admin-title" style={{
          fontFamily: "'Playfair Display'",
          fontWeight: 800,
          color:      tokens.ink,
          margin:     0,
          lineHeight: 1.1,
        }}>
          Admin · Users
        </h1>
        <div className="tle-admin-header-actions">
          <Link href="/admin/metrics" style={headerBtn(tokens.terra, '#fff', tokens.terra)}>
            MÉTRIQUES →
          </Link>
          <button onClick={refresh} disabled={loading} style={{
            ...headerBtn(tokens.creamDark, tokens.inkMid, tokens.creamBorder),
            cursor: loading ? 'wait' : 'pointer',
          }}>
            {loading ? '…' : 'RAFRAÎCHIR'}
          </button>
          <Link href="/" style={headerBtn(tokens.surface, tokens.inkMid, tokens.creamBorder)}>
            ← APP
          </Link>
        </div>
      </div>

      <div style={{ ...CARD, maxWidth: 1080, margin: '0 auto' }}>
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

            {/* Card stack on mobile, single-line grid row on
                desktop — same JSX, the CSS up top swaps the
                grid-template-columns based on viewport. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {users.map(u => (
                <div
                  key={u.id}
                  className="tle-admin-userrow"
                  style={{
                    padding: '14px 16px',
                    background: tokens.surface,
                    border: `1px solid ${tokens.creamBorder}`,
                    borderRadius: 6,
                  }}
                >
                  {/* Identity column */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {u.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.image} alt="" width={36} height={36} style={{ borderRadius: '50%', flexShrink: 0 }} />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: tokens.terra, color: '#fff', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}>
                        {(u.name ?? u.email ?? '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 14, fontWeight: 700, color: tokens.ink, lineHeight: 1.2 }}>
                        {u.name ?? '—'}
                      </span>
                      {/* UUID: shown small + monospace, click-to-copy.
                          Truncated visually with maxWidth + ellipsis so
                          the card layout stays compact, BUT the full
                          value is what gets selected / copied. */}
                      <code
                        onClick={() => navigator.clipboard?.writeText(u.id)}
                        title={`Cliquer pour copier — ${u.id}`}
                        style={{
                          fontSize: 10, color: tokens.inkLight,
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                          userSelect: 'all',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                      >
                        {u.id}
                      </code>
                    </div>
                  </div>

                  {/* Email */}
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, wordBreak: 'break-all' }}>
                    <span className="tle-admin-meta-label" style={metaLabel}>Email </span>
                    {u.email ?? '—'}
                  </div>

                  {/* Providers */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="tle-admin-meta-label" style={metaLabel}>Providers </span>
                    {u.providers.includes('google') && <Badge label="Google" color="#4285F4" />}
                    {u.providers.includes('strava') && <Badge label="Strava" color="#FC4C02" />}
                    {u.providers.length === 0 && <span style={{ color: tokens.inkLight, fontSize: 11 }}>—</span>}
                  </div>

                  {/* Strava ID */}
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: tokens.inkMid }}>
                    <span className="tle-admin-meta-label" style={metaLabel}>Strava ID </span>
                    {u.athleteId ?? <span style={{ color: tokens.inkLight }}>—</span>}
                  </div>

                  {/* Activities count */}
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: tokens.ink }}>
                    <span className="tle-admin-meta-label" style={metaLabel}>Activités </span>
                    {u.activities}
                  </div>

                  {/* Inscription date */}
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, whiteSpace: 'nowrap' }}>
                    <span className="tle-admin-meta-label" style={metaLabel}>Inscrit </span>
                    {formatDate(u.createdAt)}
                  </div>

                  {/* Delete action */}
                  <div>
                    <button
                      onClick={() => deleteUser(u)}
                      disabled={deletingId === u.id}
                      title="Supprimer définitivement ce compte (cascade sur toutes ses données)"
                      style={{
                        width: '100%',
                        padding: '8px 14px',
                        background:   deletingId === u.id ? '#FCC' : 'transparent',
                        border:       `1px solid ${deletingId === u.id ? '#A00' : '#E5B4B4'}`,
                        borderRadius: 3,
                        color:        '#A00',
                        fontFamily:   "'Space Grotesk'",
                        fontSize:     12,
                        fontWeight:   600,
                        cursor:       deletingId === u.id ? 'wait' : 'pointer',
                        opacity:      deletingId === u.id ? 0.6 : 1,
                        whiteSpace:   'nowrap',
                      }}
                    >
                      {deletingId === u.id ? '…' : '✗ Supprimer'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/// Inline label shown on mobile only (hidden on desktop via the
/// .tle-admin-meta-label rule in the <style> block). Lets each
/// card cell carry its own field name so the user doesn't have
/// to remember which value is which.
const metaLabel: React.CSSProperties = {
  fontFamily: "'Space Grotesk'",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: tokens.inkLight,
  marginRight: 8,
};

function headerBtn(bg: string, fg: string, border: string): React.CSSProperties {
  return {
    padding: '8px 14px',
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 3,
    color: fg,
    fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
    letterSpacing: '0.04em',
    textDecoration: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
