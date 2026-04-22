'use client';

import { activities, globalStats, tokens, Activity } from '../tokens';
import { SectionTag } from '../ui';
import { ActivityCard } from '../ActivityCard';

export function FeedPage({ onSelect }: { onSelect: (a: Activity) => void }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
      <SectionTag num={1} title="ACTIVITÉS RÉCENTES" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 40, fontWeight: 900, color: tokens.ink, lineHeight: 1.1, marginBottom: 32 }}>
        {globalStats.totalActivities} sorties.<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>Toujours plus loin.</em>
      </h1>
      {activities.map(a => <ActivityCard key={a.id} activity={a} onClick={onSelect} />)}
    </div>
  );
}
