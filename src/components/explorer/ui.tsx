'use client';

import { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { tokens } from './tokens';

export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return m;
}

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: 10, fontWeight: 500, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: tokens.inkLight,
      ...style,
    }}>
      {children}
    </span>
  );
}

export function SectionTag({ num, title }: { num: number; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
      <Label style={{ color: tokens.terra }}>§ {String(num).padStart(2, '0')}</Label>
      <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
      <Label>{title}</Label>
    </div>
  );
}

export function StatBar({ label, value, max, unit, color }: {
  label: string; value: number; max: number; unit: string; color?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(pct), 200);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Label>{label}</Label>
        <span style={{ fontFamily: "'Playfair Display'", fontSize: 13, fontWeight: 700, color: tokens.ink }}>
          {value.toLocaleString()}
          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, marginLeft: 3, color: tokens.inkLight }}>{unit}</span>
        </span>
      </div>
      <div style={{ height: 3, background: tokens.creamBorder, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: animated + '%', background: color || tokens.terra,
          borderRadius: 2, transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)',
        }} />
      </div>
    </div>
  );
}

import { useT } from '@/i18n';

export function TypeBadge({ type }: { type: 'cycling' | 'running' | 'hiking' }) {
  const { t } = useT();
  const config = {
    cycling: { bg: tokens.terraLight, fg: tokens.terra, key: 'type.cycling' },
    running: { bg: tokens.greenLight, fg: tokens.green, key: 'type.running' },
    hiking:  { bg: tokens.greenLight, fg: tokens.green, key: 'type.hiking' },
  } as const;
  const c = config[type] ?? config.cycling;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px',
      background: c.bg, color: c.fg,
      fontFamily: "'Space Grotesk'", fontSize: 9, fontWeight: 600,
      letterSpacing: '0.12em', textTransform: 'uppercase', borderRadius: 2,
    }}>
      {t(c.key)}
    </span>
  );
}

export function StatChip({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div style={{ flex: 1 }}>
      <Label style={{ display: 'block', marginBottom: 5, fontSize: 10 }}>{label}</Label>
      <span style={{ fontFamily: "'Playfair Display'", fontSize: 26, fontWeight: 700, color: tokens.ink }}>{value}</span>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, marginLeft: 4 }}>{unit}</span>
    </div>
  );
}
