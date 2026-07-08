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
import { SocialActivityCard, Avatar, FollowButton } from '../social/components';
import { fetchFeed, searchUsers } from '../social/api';
import type { FeedItem, UserSearchResult } from '../social/types';

export function SocialFeedPage() {
  const router = useRouter();
  const [source, setSource] = useState<'following' | 'mine'>('following');
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchResult[] | null>(null);

  useEffect(() => {
    setItems(null); setError(null);
    fetchFeed(source).then(setItems).catch(e => setError((e as Error).message));
  }, [source]);

  // Debounced user search.
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const h = setTimeout(() => { searchUsers(q).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const openProfile = (uid: string) => router.push(`/u/${uid}`);

  return (
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

      {/* Source toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['following', 'mine'] as const).map(s => (
          <button key={s} onClick={() => setSource(s)} style={{
            flex: 1, padding: '9px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12, letterSpacing: '0.04em',
            border: `1px solid ${source === s ? tokens.terra : tokens.creamBorder}`,
            background: source === s ? tokens.terra : 'transparent', color: source === s ? '#fff' : tokens.inkMid,
          }}>{s === 'following' ? 'SUIVIS' : 'MOI'}</button>
        ))}
      </div>

      {error && <div style={{ padding: 14, background: '#FEE', border: '1px solid #FCC', borderRadius: 6, color: '#A00' }}>Erreur de chargement du feed.</div>}
      {!items && !error && <div style={{ color: tokens.inkMid }}>Chargement…</div>}
      {items && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: tokens.inkMid }}>
          {source === 'following'
            ? 'Ton feed est vide. Abonne-toi à des gens avec la recherche ci-dessus.'
            : "Tu n'as pas encore de sortie."}
        </div>
      )}
      {items?.map(it => <SocialActivityCard key={it.id} item={it} onOpenProfile={openProfile} />)}
    </div>
  );
}
