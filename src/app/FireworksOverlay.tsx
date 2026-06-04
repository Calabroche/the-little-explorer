'use client';

import { useEffect, useRef, useState } from 'react';

// Full-screen fireworks loading splash shown for ~5 s when the web app
// loads. Mirrors the native (SwiftUI) FireworksView: rings of coloured
// sparks that fly out, arc down under gravity and fade. Opaque backdrop so
// it doubles as the loading screen, then fades out to reveal the app.
const PALETTE = ['#E0883D', '#E84393', '#E3C13D', '#5B9A5E', '#3DB1C0', '#9B59B6', '#C0392B', '#48C9B0'];
const INTENSITY = 1.5;
const SPAWN_MS = 5000;   // keep launching bursts for 5 s
const LIFE_MS = 1600;    // how long a burst stays visible
const FADE_AT = 4700;    // begin fading the overlay
const HIDE_AT = 5300;    // unmount

interface Spark { vx: number; vy: number; size: number; color: string }
interface Burst { cx: number; cy: number; sparks: Spark[]; start: number }

export function FireworksOverlay() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const bursts: Burst[] = [];
    const t0 = performance.now();
    let lastSpawn = 0;
    let raf = 0;
    let running = true;

    const spawn = (now: number) => {
      const cx = (0.15 + Math.random() * 0.7) * canvas.width;
      const cy = (0.14 + Math.random() * 0.36) * canvas.height;
      const base = PALETTE[(Math.random() * PALETTE.length) | 0];
      const count = Math.round((30 + Math.random() * 16) * INTENSITY);
      const reach = (0.9 + Math.random() * 0.5) * canvas.width * 0.2;
      const sparks: Spark[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
        const s = reach * (0.6 + Math.random() * 0.5);
        sparks.push({
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          size: (2 + Math.random() * 3) * dpr * 1.1,
          color: Math.random() < 0.18 ? PALETTE[(Math.random() * PALETTE.length) | 0] : base,
        });
      }
      bursts.push({ cx, cy, sparks, start: now });
    };

    // Opening volley.
    spawn(t0); spawn(t0); spawn(t0);

    const frame = (now: number) => {
      if (!running) return;
      const elapsed = now - t0;
      if (elapsed < SPAWN_MS && now - lastSpawn > (340 / INTENSITY) * (0.7 + Math.random() * 0.6)) {
        spawn(now);
        lastSpawn = now;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bursts) {
        const t = (now - b.start) / LIFE_MS;
        if (t < 0 || t > 1) continue;
        const eased = 1 - Math.pow(1 - t, 3);
        ctx.globalAlpha = Math.max(0, 1 - t);
        for (const s of b.sparks) {
          const px = b.cx + s.vx * eased;
          const py = b.cy + s.vy * eased + canvas.height * 0.22 * t * t; // gravity
          const r = s.size * (1 - t * 0.5);
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      for (let i = bursts.length - 1; i >= 0; i--) {
        if (now - bursts[i].start > LIFE_MS) bursts.splice(i, 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const fadeT = window.setTimeout(() => setFading(true), FADE_AT);
    const hideT = window.setTimeout(() => { running = false; setVisible(false); }, HIDE_AT);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      clearTimeout(fadeT);
      clearTimeout(hideT);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: '#1a1714', pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: fading ? 0 : 1, transition: 'opacity 0.6s ease',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'relative', textAlign: 'center', fontFamily: "'Playfair Display'", color: '#fff', lineHeight: 1.05 }}>
        <div style={{ fontSize: 46, fontWeight: 900 }}>The Little</div>
        <div style={{ fontSize: 46, fontWeight: 900, fontStyle: 'italic', color: '#E0883D' }}>Explorer</div>
      </div>
    </div>
  );
}
