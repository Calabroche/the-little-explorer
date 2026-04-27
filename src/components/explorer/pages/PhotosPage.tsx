'use client';

import { tokens, Activity } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';

interface Props {
  activities: Activity[];
}

export function PhotosPage({ activities }: Props) {
  const isMobile = useIsMobile();
  const allPhotos = activities.flatMap(a => a.photos.map(p => ({ url: p, title: a.title })));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={4} title="GALERIE PHOTOS" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink, marginBottom: isMobile ? 20 : 32, lineHeight: 1.1 }}>
        {allPhotos.length} photos.<br />
        <em style={{ color: tokens.green, fontStyle: 'italic' }}>Des souvenirs.</em>
      </h1>
      {allPhotos.length === 0 ? (
        <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginTop: 16 }}>
          Les photos apparaîtront ici une fois synchronisées depuis Strava.
        </p>
      ) : (
        <div style={{ columns: isMobile ? 1 : 3, gap: 10 }}>
          {allPhotos.map((p, i) => (
            <div key={i} style={{ breakInside: 'avoid', marginBottom: 10, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
              <img src={p.url} alt="" style={{ width: '100%', display: 'block' }} />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
                padding: '20px 10px 8px',
              }}>
                <Label style={{ color: 'rgba(255,255,255,0.7)' }}>{p.title}</Label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
