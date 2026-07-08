'use client';

/**
 * Social-layer UI components, shared by the feed page and public profiles:
 *   TraceSvg          — aspect-correct inline SVG of a GPS trace (no tiles)
 *   FollowButton      — optimistic follow / unfollow
 *   CommentThread     — lazy-loaded comments with add / delete
 *   ShareActivity     — copy public link + download a story image (canvas)
 *   SocialActivityCard — the feed/profile card composing all of the above
 */
import { useEffect, useRef, useState } from 'react';
import { tokens } from '../tokens';
import type { FeedItem, Comment, Visibility } from './types';
import * as api from './api';

const VIS_LABEL: Record<Visibility, string> = { public: 'Public', followers: 'Abonnés', private: 'Moi' };

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function fmtDuration(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

// ── GPS trace as an aspect-correct SVG polyline ────────────────────────────
export function TraceSvg({ gps, width = 260, height = 120, stroke = tokens.terra }: {
  gps: [number, number][]; width?: number; height?: number; stroke?: string;
}) {
  const pts = (gps ?? []).filter(p => Array.isArray(p) && p.length >= 2);
  if (pts.length < 2) return null;
  const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  // Scale longitude by cos(lat) so the trace isn't horizontally stretched.
  const kx = Math.cos((midLat * Math.PI) / 180) || 1;
  const spanX = Math.max(1e-6, (maxLng - minLng) * kx);
  const spanY = Math.max(1e-6, maxLat - minLat);
  const pad = 8;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const w2 = spanX * scale, h2 = spanY * scale;
  const offX = (width - w2) / 2, offY = (height - h2) / 2;
  const project = (lat: number, lng: number): [number, number] => [
    offX + ((lng - minLng) * kx) * scale,
    offY + (maxLat - lat) * scale, // invert Y (north up)
  ];
  const d = pts.map((p, i) => { const [x, y] = project(p[0], p[1]); return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Avatar ──────────────────────────────────────────────────────────────────
export function Avatar({ src, name, size = 34 }: { src: string | null; name: string | null; size?: number }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name ?? ''} width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: tokens.terra, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: size * 0.42,
    }}>{initial}</div>
  );
}

// ── Follow button ─────────────────────────────────────────────────────────
export function FollowButton({ userId, initialFollowing, onChange }: {
  userId: string; initialFollowing: boolean; onChange?: (following: boolean) => void;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next); // optimistic
    try { next ? await api.followUser(userId) : await api.unfollowUser(userId); onChange?.(next); }
    catch { setFollowing(!next); } // revert
    finally { setBusy(false); }
  };
  return (
    <button onClick={toggle} disabled={busy} style={{
      padding: '7px 16px', borderRadius: 3, cursor: busy ? 'default' : 'pointer',
      fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 12, letterSpacing: '0.04em',
      background: following ? 'transparent' : tokens.terra,
      color: following ? tokens.inkMid : '#fff',
      border: `1px solid ${following ? tokens.creamBorder : tokens.terra}`,
    }}>{following ? 'ABONNÉ' : "S'ABONNER"}</button>
  );
}

// ── Comments ─────────────────────────────────────────────────────────────
function CommentThread({ activityId, onCountChange }: { activityId: number; onCountChange?: (n: number) => void }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.fetchComments(activityId).then(setComments).catch(() => setComments([])); }, [activityId]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const { comment } = await api.postComment(activityId, body);
      setComments(prev => { const next = [...(prev ?? []), comment]; onCountChange?.(next.length); return next; });
      setDraft('');
    } catch { /* keep draft so the user can retry */ } finally { setBusy(false); }
  };
  const remove = async (cid: string) => {
    try { await api.deleteComment(activityId, cid); setComments(prev => { const next = (prev ?? []).filter(c => c.id !== cid); onCountChange?.(next.length); return next; }); }
    catch { /* ignore */ }
  };

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${tokens.creamBorder}`, paddingTop: 10 }}>
      {comments === null && <div style={{ fontSize: 12, color: tokens.inkLight }}>Chargement…</div>}
      {comments?.map(c => (
        <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0' }}>
          <Avatar src={c.author.image} name={c.author.name} size={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: tokens.ink }}>{c.author.name ?? 'Anonyme'}</span>
            <span style={{ fontSize: 12, color: tokens.inkMid, marginLeft: 6 }}>{c.body}</span>
          </div>
          {c.is_mine && <button onClick={() => remove(c.id)} style={{ background: 'none', border: 'none', color: tokens.inkLight, cursor: 'pointer', fontSize: 11 }}>✕</button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Ajouter un commentaire…" style={{
            flex: 1, padding: '8px 10px', border: `1px solid ${tokens.creamBorder}`, borderRadius: 3,
            background: tokens.cream, fontSize: 13, color: tokens.ink, fontFamily: "'Space Grotesk'",
          }} />
        <button onClick={submit} disabled={busy || !draft.trim()} style={{
          padding: '8px 14px', borderRadius: 3, border: 'none', cursor: 'pointer',
          background: draft.trim() ? tokens.terra : tokens.creamBorder, color: '#fff', fontWeight: 700, fontSize: 12,
        }}>OK</button>
      </div>
    </div>
  );
}

// ── Share (public link + story image) ───────────────────────────────────
function drawStoryImage(item: FeedItem): HTMLCanvasElement {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#F5EFE6'); grad.addColorStop(1, '#EAD9C6');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  // Brand
  ctx.fillStyle = '#C4602A'; ctx.font = '700 44px Georgia, serif';
  ctx.fillText('The Little Explorer', 80, 140);
  // Title
  ctx.fillStyle = '#2A2723'; ctx.font = '900 84px Georgia, serif';
  ctx.fillText((item.title ?? 'Sortie').slice(0, 22), 80, 260);
  // Trace
  const pts = (item.gps ?? []).filter(p => Array.isArray(p) && p.length >= 2);
  if (pts.length >= 2) {
    const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2, kx = Math.cos(midLat * Math.PI / 180) || 1;
    const spanX = Math.max(1e-6, (maxLng - minLng) * kx), spanY = Math.max(1e-6, maxLat - minLat);
    const boxX = 80, boxY = 360, boxW = W - 160, boxH = 900, pad = 40;
    const scale = Math.min((boxW - pad * 2) / spanX, (boxH - pad * 2) / spanY);
    const w2 = spanX * scale, h2 = spanY * scale, offX = boxX + (boxW - w2) / 2, offY = boxY + (boxH - h2) / 2;
    ctx.strokeStyle = '#C4602A'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = offX + (p[1] - minLng) * kx * scale, y = offY + (maxLat - p[0]) * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  // Stats row
  const stats: [string, string][] = [
    ['DISTANCE', item.distance_km != null ? `${item.distance_km.toFixed(1)} km` : '—'],
    ['DÉNIVELÉ', item.elevation_m != null ? `${item.elevation_m} m` : '—'],
    ['TEMPS', fmtDuration(item.duration_min)],
    ['V. MAX', item.max_speed_kmh != null ? `${item.max_speed_kmh.toFixed(1)} km/h` : '—'],
  ];
  const y0 = 1450, colW = (W - 160) / 2;
  stats.forEach(([label, value], i) => {
    const x = 80 + (i % 2) * colW, y = y0 + Math.floor(i / 2) * 200;
    ctx.fillStyle = '#8A8175'; ctx.font = '700 32px "Space Grotesk", sans-serif'; ctx.fillText(label, x, y);
    ctx.fillStyle = '#2A2723'; ctx.font = '800 76px Georgia, serif'; ctx.fillText(value, x, y + 80);
  });
  return canvas;
}

export function ShareActivity({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = drawStoryImage(item);
    canvas.style.width = '100%'; canvas.style.borderRadius = '8px'; canvas.style.display = 'block';
    const host = previewRef.current;
    if (host) { host.innerHTML = ''; host.appendChild(canvas); }
  }, [item]);

  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/share/activity/${item.id}` : '';

  const copyLink = async () => {
    if (item.visibility !== 'public') return;
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  const downloadImage = async () => {
    const canvas = drawStoryImage(item);
    canvas.toBlob(async blob => {
      if (!blob) return;
      const file = new File([blob], `tle-${item.id}.png`, { type: 'image/png' });
      // Prefer the native share sheet (mobile → Instagram); fall back to download.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav: any = navigator;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        try { await nav.share({ files: [file], title: item.title ?? 'Ma sortie' }); return; } catch { /* fall through */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: tokens.surface, borderRadius: 10, padding: 20, maxWidth: 380, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 14, color: tokens.ink }}>Partager</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: tokens.inkMid }}>✕</button>
        </div>
        <div ref={previewRef} style={{ marginBottom: 14, border: `1px solid ${tokens.creamBorder}`, borderRadius: 8, overflow: 'hidden' }} />
        <button onClick={downloadImage} style={{ width: '100%', padding: '12px', borderRadius: 4, border: 'none', background: tokens.terra, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
          📸 Partager l&apos;image (story)
        </button>
        <button onClick={copyLink} disabled={item.visibility !== 'public'} title={item.visibility !== 'public' ? 'Passe la sortie en Public pour la partager par lien' : ''} style={{
          width: '100%', padding: '12px', borderRadius: 4, cursor: item.visibility === 'public' ? 'pointer' : 'not-allowed',
          border: `1px solid ${tokens.creamBorder}`, background: 'transparent', color: item.visibility === 'public' ? tokens.ink : tokens.inkLight, fontWeight: 600, fontSize: 13,
        }}>{copied ? '✓ Lien copié' : item.visibility === 'public' ? '🔗 Copier le lien public' : '🔒 Lien public (mets en Public)'}</button>
      </div>
    </div>
  );
}

// ── The card ───────────────────────────────────────────────────────────────
export function SocialActivityCard({ item, onOpenProfile }: {
  item: FeedItem; onOpenProfile?: (userId: string) => void;
}) {
  const [liked, setLiked] = useState(item.liked_by_me);
  const [likeCount, setLikeCount] = useState(item.like_count);
  const [commentCount, setCommentCount] = useState(item.comment_count);
  const [showComments, setShowComments] = useState(false);
  const [visibility, setVis] = useState<Visibility>(item.visibility);
  const [sharing, setSharing] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  const toggleLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    const next = !liked;
    setLiked(next); setLikeCount(c => c + (next ? 1 : -1)); // optimistic
    try { next ? await api.likeActivity(item.id) : await api.unlikeActivity(item.id); }
    catch { setLiked(!next); setLikeCount(c => c + (next ? -1 : 1)); }
    finally { setLikeBusy(false); }
  };
  const changeVis = async (v: Visibility) => {
    const prev = visibility; setVis(v);
    try { await api.setVisibility(item.id, v); } catch { setVis(prev); }
  };

  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 8, padding: 16, marginBottom: 14 }}>
      {/* Author header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => onOpenProfile?.(item.author.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: onOpenProfile ? 'pointer' : 'default' }}>
          <Avatar src={item.author.image} name={item.author.name} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <button onClick={() => onOpenProfile?.(item.author.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: onOpenProfile ? 'pointer' : 'default', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 14, color: tokens.ink }}>
            {item.author.name ?? 'Anonyme'}
          </button>
          <div style={{ fontSize: 11, color: tokens.inkLight }}>{fmtDate(item.date)} · {item.sport}</div>
        </div>
        {item.is_mine && (
          <select value={visibility} onChange={e => changeVis(e.target.value as Visibility)} title="Visibilité" style={{
            fontSize: 11, padding: '4px 6px', borderRadius: 4, border: `1px solid ${tokens.creamBorder}`, background: tokens.cream, color: tokens.inkMid, cursor: 'pointer',
          }}>
            {(['public', 'followers', 'private'] as Visibility[]).map(v => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
          </select>
        )}
      </div>

      {item.title && <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 800, color: tokens.ink, marginBottom: 8 }}>{item.title}</div>}

      {item.gps.length >= 2 && (
        <div style={{ background: tokens.cream, borderRadius: 6, padding: 6, marginBottom: 10 }}>
          <TraceSvg gps={item.gps} width={520} height={160} />
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 12 }}>
        <Stat label="Distance" value={item.distance_km != null ? `${item.distance_km.toFixed(1)} km` : '—'} />
        <Stat label="Dénivelé +" value={item.elevation_m != null ? `${item.elevation_m} m` : '—'} color={tokens.terra} />
        <Stat label="Temps" value={fmtDuration(item.duration_min)} />
        <Stat label="Vitesse max" value={item.max_speed_kmh != null ? `${item.max_speed_kmh.toFixed(1)} km/h` : '—'} color="#3E6FA3" />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${tokens.creamBorder}`, paddingTop: 10 }}>
        <ActionBtn onClick={toggleLike} active={liked} label={`${liked ? '❤️' : '🤍'} ${likeCount}`} />
        <ActionBtn onClick={() => setShowComments(s => !s)} label={`💬 ${commentCount}`} />
        <ActionBtn onClick={() => setSharing(true)} label="↗ Partager" />
      </div>

      {showComments && <CommentThread activityId={item.id} onCountChange={setCommentCount} />}
      {sharing && <ShareActivity item={{ ...item, visibility }} onClose={() => setSharing(false)} />}
    </div>
  );
}

function Stat({ label, value, color = tokens.ink }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 9, color: tokens.inkLight, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
}
function ActionBtn({ onClick, label, active }: { onClick: () => void; label: string; active?: boolean }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '8px', borderRadius: 4, cursor: 'pointer',
      border: `1px solid ${tokens.creamBorder}`, background: active ? tokens.creamDark : 'transparent',
      color: tokens.inkMid, fontWeight: 600, fontSize: 12, fontFamily: "'Space Grotesk'",
    }}>{label}</button>
  );
}
