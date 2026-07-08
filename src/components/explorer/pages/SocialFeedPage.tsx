'use client';

/**
 * SocialFeedPage — the "Suivis" home feed. Shows activities from people you
 * follow (+ your own), Strava-style, with like / comment / share on each card
 * and a "Trouver des amis" search to grow your following. Self-fetching from
 * /api/feed; opening a profile routes to /u/<id>.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '../tokens';
import { SocialActivityCard, Avatar, FollowButton, activityHref } from '../social/components';
import { fetchFeed, searchUsers } from '../social/api';
import type { FeedItem, UserSearchResult } from '../social/types';

export function SocialFeedPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchResult[] | null>(null);

  // Home = the following feed only (your own rides live on your profile).
  useEffect(() => {
    setItems(null); setError(null);
    fetchFeed('following').then(setItems).catch(e => setError((e as Error).message));
  }, []);

  // Debounced user search.
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const h = setTimeout(() => { searchUsers(q).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const openProfile = (uid: string) => router.push(`/u/${uid}`);

  return (
    // flex:1 + own scroll — <main> is overflow:hidden, so each page scrolls itself.
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '20px 16px 80px' }}>
      {/* Search */}
      <div style={{ marginBottom: 16, position: 'relative' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Trouver des amis…" style={{
          width: '100%', padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.creamBorder}`,
          background: tokens.surface, fontSize: 14, color: tokens.ink, fontFamily: "'Space Grotesk'", boxSizing: 'border-box',
        }} />
        {results && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
            {results.length === 0 && <div style={{ padding: 12, color: tokens.inkLight, fontSize: 13 }}>Personne trouvé.</div>}
            {results.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${tokens.creamBorder}` }}>
                <button onClick={() => openProfile(u.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Avatar src={u.image} name={u.name} size={30} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: tokens.ink }}>{u.name ?? 'Anonyme'}</span>
                </button>
                <FollowButton userId={u.id} initialFollowing={u.is_following} />
              </div>
            ))}
          </div>
        )}
      </div>

      {error &&<div style={{ padding: 14, background: '#FEE', border: '1px solid #FCC', borderRadius: 6, color: '#A00' }}>Erreur de chargement du feed.</div>}
      {!items && !error && <div style={{ color: tokens.inkMid }}>Chargement…</div>}
      {items && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: tokens.inkMid }}>
          Ton fil est vide. Cherche des amis ci-dessus pour voir leurs sorties ici.
        </div>
      )}
      {items?.map(it => (
        <SocialActivityCard key={it.id} item={it} onOpenProfile={openProfile}
          onOpenActivity={a => router.push(activityHref(a))} />
      ))}
    </div>
    </div>
  );
}
