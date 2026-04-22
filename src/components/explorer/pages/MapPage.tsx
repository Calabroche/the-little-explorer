'use client';

import { globalStats, tokens } from '../tokens';
import { SectionTag, Label } from '../ui';
import { MapPlaceholder } from '../MapPlaceholder';

export function MapPage() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '32px 40px 24px', borderBottom: `1px solid ${tokens.creamBorder}`, background: 'white' }}>
        <SectionTag num={2} title="CARTE DES PARCOURS" />
        <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 36, fontWeight: 900, color: tokens.ink }}>
          Mes <em style={{ color: tokens.green, fontStyle: 'italic' }}>territoires</em>
        </h1>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <MapPlaceholder />
        <div style={{
          position: 'absolute', top: 24, right: 24, background: 'white',
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 16, minWidth: 180,
        }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>LÉGENDE</Label>
          {[
            { color: tokens.terra, label: 'Vélo', count: globalStats.cycling },
            { color: tokens.green, label: 'Randonnée', count: globalStats.hiking },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 20, height: 2.5, background: l.color, borderRadius: 2 }} />
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, flex: 1 }}>{l.label}</span>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700 }}>{l.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
