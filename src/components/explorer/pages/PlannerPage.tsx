'use client';

import { tokens, Activity } from '../tokens';
import { SectionTag, useIsMobile } from '../ui';
import { RouteBuilder } from '../RouteBuilder';
import { RouteProposals } from '../RouteProposals';
import { TrainingPlan } from '../TrainingPlan';
import { useT } from '@/i18n';

export function PlannerPage({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  const { t } = useT();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={2} title={t('planner.sectionTag')} />
      <h1 style={{
        fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900,
        color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32,
      }}>
        {t('planner.headline')}<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>
          {t('planner.headlineEm')}
        </em>
      </h1>
      <TrainingPlan activities={activities} />
      <RouteBuilder activities={activities} />
      <RouteProposals activities={activities} />
    </div>
  );
}
