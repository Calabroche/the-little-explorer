'use client';

import { tokens, Activity } from '../tokens';
import { SectionTag, useIsMobile } from '../ui';
import { RouteBuilder } from '../RouteBuilder';

export function PlannerPage({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={2} title="PLANIFICATEUR DE PARCOURS" />
      <h1 style={{
        fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900,
        color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32,
      }}>
        Construis ta sortie.<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>
          Boucles 100% Dardilly.
        </em>
      </h1>
      <RouteBuilder activities={activities} />
    </div>
  );
}
