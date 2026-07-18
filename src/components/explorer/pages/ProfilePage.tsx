'use client';

/**
 * ProfilePage — the signed-in user's own profile (Strava/Instagram style):
 * identity + bio, clickable followers / following counts, and all their own
 * data (the full activity dashboard). This is where "Activités" now lives —
 * the home page is the social feed of people you follow.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { FeedPage } from './FeedPage';
import { tokens, Activity, GlobalStats } from '../tokens';
import type { SportId } from '../Sidebar';
import { Avatar, ConnectionsModal } from '../social/components';
import { fetchProfile } from '../social/api';
import type { Profile } from '../social/types';

export function ProfilePage({ activities, stats, sport, onSelect, onSportChange, availableSports }: {
  activities: Activity[];
  stats: GlobalStats;
  sport: SportId;
  onSelect: (a: Activity) => void;
  onSportChange?: (s: SportId) => void;
  availableSports?: SportId[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conns, setConns] = useState<'followers' | 'following' | null>(null);
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Prefer the session's user id (already in memory) so we skip the /api/me
  // round-trip and only make ONE call for the counts + bio. Fall back to
  // /api/me if the session doesn't carry an id.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uid = (session?.user as any)?.id as string | undefined;
    if (uid) { fetchProfile(uid).then(setProfile).catch(() => {}); return; }
    fetch('/api/me')
      .then(r => (r.ok ? r.json() : null))
      .then((me: { id?: string } | null) => {
        if (me?.id) fetchProfile(me.id).then(setProfile).catch(() => {});
      })
      .catch(() => {});
  }, [session]);

  const startEdit = () => { setBioDraft(profile?.bio ?? ''); setEditingBio(true); };
  const saveBio = async () => {
    setSavingBio(true);
    try {
      const r = await fetch('/api/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: bioDraft.trim().length === 0 ? null : bioDraft.trim() }),
      });
      if (r.ok) setProfile(p => (p ? { ...p, bio: bioDraft.trim().length === 0 ? null : bioDraft.trim() } : p));
      setEditingBio(false);
    } catch { /* keep editor open */ }
    finally { setSavingBio(false); }
  };

  return (
    // flex column: fixed header on top, the dashboard (FeedPage) scrolls below.
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {(profile || session?.user) && (
        // Full-width header band — no floating box, so no black side gutters.
        // Rendered as soon as the session identity is available (no waiting on
        // the profile fetch), so the banner is there instantly; the counts and
        // description fill in when /api/users/[id] returns.
        <div style={{ width: '100%', background: tokens.surface, borderBottom: `1px solid ${tokens.creamBorder}` }}>
          {/* Same horizontal padding as the dashboard below (full-width, 40px)
              so the avatar/name line up with the activity cards underneath. */}
          <div style={{ padding: isMobile ? '20px 16px' : '28px 40px', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <Avatar src={profile?.image ?? session?.user?.image ?? null} name={profile?.name ?? session?.user?.name ?? null} size={isMobile ? 68 : 88} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Name + edit action together — the edit button lives next to the
                    name, not top-right where it collided with the floating chips. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 800, color: tokens.ink, margin: 0 }}>
                    {profile?.name ?? session?.user?.name ?? 'Mon profil'}
                  </h1>
                  <button onClick={() => router.push('/settings')} style={{
                    padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 11, letterSpacing: '0.04em',
                    background: 'transparent', color: tokens.inkMid, border: `1px solid ${tokens.creamBorder}`, whiteSpace: 'nowrap',
                  }}>MODIFIER</button>
                </div>
                <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 14, color: tokens.inkMid }}>
                  <button onClick={() => setConns('followers')} style={linkBtn}><strong>{profile?.followers ?? '—'}</strong> abonnés</button>
                  <button onClick={() => setConns('following')} style={linkBtn}><strong>{profile?.following ?? '—'}</strong> abonnements</button>
                </div>
              </div>
            </div>

            {/* Description — displayed + inline editable, no trip to /settings. */}
            {profile && (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${tokens.creamBorder}` }}>
              {editingBio ? (
                <div>
                  <textarea
                    value={bioDraft} maxLength={280} rows={3} autoFocus
                    onChange={e => setBioDraft(e.target.value)}
                    placeholder="Décris-toi en quelques mots (vélo, objectifs, terrain de jeu…)"
                    style={{
                      width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px',
                      borderRadius: 8, border: `1px solid ${tokens.creamBorder}`, background: tokens.cream,
                      fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, color: tokens.ink, lineHeight: 1.5,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <button onClick={saveBio} disabled={savingBio} style={{
                      padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: tokens.terra, color: '#fff', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 12, opacity: savingBio ? 0.6 : 1,
                    }}>{savingBio ? 'Enregistrement…' : 'Enregistrer'}</button>
                    <button onClick={() => setEditingBio(false)} style={{
                      padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
                      background: 'transparent', color: tokens.inkMid, border: `1px solid ${tokens.creamBorder}`, fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 12,
                    }}>Annuler</button>
                    <span style={{ fontSize: 11, color: tokens.inkLight, marginLeft: 'auto' }}>{bioDraft.length}/280</span>
                  </div>
                </div>
              ) : profile.bio ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <p style={{ flex: 1, fontSize: 15, color: tokens.inkMid, lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
                  <button onClick={startEdit} style={{ ...linkBtn, color: tokens.terra, fontWeight: 600, whiteSpace: 'nowrap' }}>Modifier</button>
                </div>
              ) : (
                <button onClick={startEdit} style={{ ...linkBtn, color: tokens.terra, fontWeight: 600, fontSize: 14 }}>
                  ＋ Ajouter une description
                </button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* All my data — the full activity dashboard. */}
      <FeedPage activities={activities} stats={stats} sport={sport} onSelect={onSelect} onSportChange={onSportChange} availableSports={availableSports} />

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
