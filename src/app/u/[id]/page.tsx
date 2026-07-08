'use client';

/**
 * /u/<id> — a user's public profile: identity + bio, follower/following
 * counts, a follow button, and the activities the viewer is allowed to see
 * (per-activity visibility, enforced server-side by /api/users/<id>).
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { tokens } from '@/components/explorer/tokens';
import { fetchProfile } from '@/components/explorer/social/api';
import { Avatar, FollowButton, SocialActivityCard, activityHref } from '@/components/explorer/social/components';
import type { Profile } from '@/components/explorer/social/types';

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setProfile(null); setError(null);
    fetchProfile(id).then(setProfile).catch(e => setError((e as Error).message));
  }, [id]);

  return (
    <main style={{ height: '100dvh', overflowY: 'auto', background: tokens.cream, padding: '32px 16px 80px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: tokens.terra, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>← Retour</button>

        {error && <div style={{ padding: 16, background: '#FEE', border: '1px solid #FCC', borderRadius: 6, color: '#A00' }}>Profil introuvable.</div>}
        {!profile && !error && <div style={{ color: tokens.inkMid }}>Chargement…</div>}

        {profile && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
              <Avatar src={profile.image} name={profile.name} size={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 800, color: tokens.ink, margin: 0 }}>{profile.name ?? 'Anonyme'}</h1>
                <div style={{ fontSize: 13, color: tokens.inkMid, marginTop: 2 }}>
                  <strong>{profile.followers}</strong> abonnés · <strong>{profile.following}</strong> abonnements
                </div>
              </div>
              {!profile.is_me && <FollowButton userId={profile.id} initialFollowing={profile.is_following} />}
            </div>

            {profile.bio && <p style={{ fontSize: 14, color: tokens.inkMid, lineHeight: 1.5, marginBottom: 20 }}>{profile.bio}</p>}

            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.terra, marginBottom: 12 }}>
              Sorties ({profile.activities.length})
            </div>
            {profile.activities.length === 0 && <div style={{ color: tokens.inkLight, fontSize: 13 }}>Aucune sortie visible.</div>}
            {profile.activities.map(a => (
              <SocialActivityCard key={a.id} item={a}
                onOpenProfile={uid => router.push(`/u/${uid}`)}
                onOpenActivity={act => router.push(activityHref(act))} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}
