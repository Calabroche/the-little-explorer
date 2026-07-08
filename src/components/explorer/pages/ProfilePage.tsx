'use client';

/**
 * ProfilePage — the signed-in user's own profile (Strava/Instagram style):
 * identity + bio, clickable followers / following counts, and all their own
 * data (the full activity dashboard). This is where "Activités" now lives —
 * the home page is the social feed of people you follow.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FeedPage } from './FeedPage';
import { tokens, Activity, GlobalStats } from '../tokens';
import type { SportId } from '../Sidebar';
import { Avatar, ConnectionsModal } from '../social/components';
import { fetchProfile } from '../social/api';
import type { Profile } from '../social/types';

export function ProfilePage({ activities, stats, sport, onSelect }: {
  activities: Activity[];
  stats: GlobalStats;
  sport: SportId;
  onSelect: (a: Activity) => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conns, setConns] = useState<'followers' | 'following' | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(r => (r.ok ? r.json() : null))
      .then((me: { id?: string } | null) => {
        if (me?.id) fetchProfile(me.id).then(setProfile).catch(() => {});
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      {profile && (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar src={profile.image} name={profile.name} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, color: tokens.ink, margin: 0 }}>
                {profile.name ?? 'Mon profil'}
              </h1>
              <div style={{ display: 'flex', gap: 18, marginTop: 4, fontSize: 13, color: tokens.inkMid }}>
                <button onClick={() => setConns('followers')} style={linkBtn}><strong>{profile.followers}</strong> abonnés</button>
                <button onClick={() => setConns('following')} style={linkBtn}><strong>{profile.following}</strong> abonnements</button>
              </div>
            </div>
            <button onClick={() => router.push('/settings')} style={{
              padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 12,
              background: 'transparent', color: tokens.inkMid, border: `1px solid ${tokens.creamBorder}`,
            }}>MODIFIER</button>
          </div>
          {profile.bio && <p style={{ fontSize: 14, color: tokens.inkMid, lineHeight: 1.5, marginTop: 12 }}>{profile.bio}</p>}
        </div>
      )}

      {/* All my data — the full activity dashboard. */}
      <FeedPage activities={activities} stats={stats} sport={sport} onSelect={onSelect} />

      {conns && profile && (
        <ConnectionsModal
          userId={profile.id}
          type={conns}
          onClose={() => setConns(null)}
          onOpenProfile={uid => router.push(`/u/${uid}`)}
        />
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: tokens.inkMid, fontSize: 13, fontFamily: "'Space Grotesk'",
};
