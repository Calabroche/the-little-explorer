'use client';

import { activities, tokens } from '../tokens';
import { SectionTag, Label } from '../ui';

export function PhotosPage() {
  const allPhotos = activities.flatMap(a => a.photos.map(p => ({ url: p, title: a.title })));
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
      <SectionTag num={4} title="GALERIE PHOTOS" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 40, fontWeight: 900, color: tokens.ink, marginBottom: 32, lineHeight: 1.1 }}>
        {allPhotos.length} photos.<br />
        <em style={{ color: tokens.green, fontStyle: 'italic' }}>Des souvenirs.</em>
      </h1>
      <div style={{ columns: 3, gap: 10 }}>
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
    </div>
  );
}
