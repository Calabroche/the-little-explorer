/**
 * Year-in-review video exporter — turns the user's YearStats into an
 * Instagram-square (1080×1080) animated MP4 / WebM that they can
 * share on social media.
 *
 * Implementation notes:
 *   * Renders frame-by-frame to an OffscreenCanvas via requestAnimation
 *     Frame. Five scenes × 3 s = 15 s total.
 *   * Uses MediaRecorder + canvas.captureStream() to encode in real-
 *     time. The output container is WebM (every modern browser ships
 *     this natively); the browser picks VP9 / VP8 / AV1 automatically
 *     depending on what it has compiled in.
 *   * Returns a Blob the caller can drop into an <a download> link.
 *
 * MP4 export deferred — would require ffmpeg.wasm to remux WebM → MP4
 * client-side (10 MB of wasm to load, slow on iOS Safari). Most
 * social platforms accept WebM directly now; if a user really needs
 * MP4 they can convert with one click in iOS Photos or any online
 * converter.
 */

export interface VideoStats {
  year:        number;
  count:       number;
  distance:    number;   // km
  elevation:   number;   // m
  hours:       number;
  longest:     { title: string; distance: number } | null;
  biggestClimb:{ title: string; elevation: number } | null;
  fastest:     { title: string; speed: number | null } | null;
  topSport:    { id: string; count: number } | null;
}

const W = 1080;
const H = 1080;
const FPS = 30;
const SCENE_DURATION_S = 3;   // each scene fades-in 0.4 s, holds 2.2 s, fades-out 0.4 s

/**
 * Render the full year-recap video. Returns a Blob (.webm) ready to
 * download.
 */
export async function renderWrappedVideo(stats: VideoStats): Promise<Blob> {
  // Build the list of scenes — skip any whose data is unavailable.
  const scenes: Scene[] = [];
  scenes.push(introScene(stats.year));
  scenes.push(metricScene('KILOMÈTRES', formatNumber(stats.distance), 'km parcourus'));
  scenes.push(metricScene('DÉNIVELÉ', formatNumber(stats.elevation), 'mètres grimpés'));
  scenes.push(metricScene('SORTIES', String(stats.count), 'rides enregistrés'));
  if (stats.longest) {
    scenes.push(highlightScene('LA PLUS LONGUE', stats.longest.title, `${stats.longest.distance.toFixed(1)} km`));
  }
  if (stats.biggestClimb) {
    scenes.push(highlightScene('LA PLUS DURE', stats.biggestClimb.title, `${stats.biggestClimb.elevation} m D+`));
  }
  scenes.push(outroScene());

  // Set up canvas + MediaRecorder.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_2d_unavailable');

  // Pick the best mime the browser supports.
  const mime = pickMime();
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const finished = new Promise<Blob>(resolve => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  recorder.start();

  // Animate through every scene, frame by frame, blocking on
  // requestAnimationFrame so MediaRecorder captures real wall-clock
  // time (not just whatever raster we drew).
  const totalFrames = scenes.length * SCENE_DURATION_S * FPS;
  const startedAt = performance.now();
  for (let frame = 0; frame < totalFrames; frame++) {
    const sceneIdx = Math.floor(frame / (SCENE_DURATION_S * FPS));
    const sceneFrame = frame % (SCENE_DURATION_S * FPS);
    const sceneT = sceneFrame / (SCENE_DURATION_S * FPS); // 0..1
    drawBackground(ctx);
    scenes[sceneIdx](ctx, sceneT);
    drawFooter(ctx);
    // Wait until enough real time has passed to match FPS. Without
    // this the loop fills the recorder buffer too fast and we end
    // up with a 0.1 s video.
    const targetT = startedAt + (frame * 1000) / FPS;
    const now = performance.now();
    if (now < targetT) {
      await sleep(targetT - now);
    }
    // Yield to the event loop so MediaRecorder can flush chunks.
    await rafYield();
  }

  recorder.stop();
  return finished;
}

// ── Scene helpers ──────────────────────────────────────────────────

type Scene = (ctx: CanvasRenderingContext2D, t: number) => void;

const COLORS = {
  cream:    '#F5EFE6',
  surface:  '#FFFCF6',
  ink:      '#2A2723',
  inkMid:   '#5C544A',
  inkLight: '#8A8175',
  terra:    '#C4602A',
  green:    '#4CAF50',
};

/** Easing curve — gentle in/out fade. */
function envelope(t: number): number {
  // Hold for the middle 60 %, fade in/out the outer 20 % each side.
  if (t < 0.2) return t / 0.2;
  if (t > 0.8) return (1 - t) / 0.2;
  return 1;
}

function introScene(year: number): Scene {
  return (ctx, t) => {
    const alpha = envelope(t);
    ctx.globalAlpha = alpha;
    // Top label
    ctx.fillStyle = COLORS.terra;
    ctx.textAlign = 'center';
    ctx.font = '700 32px "Space Grotesk", sans-serif';
    ctx.fillText('§ BILAN', W / 2, H / 2 - 220);
    // Big year
    ctx.fillStyle = COLORS.ink;
    ctx.font = '900 280px "Playfair Display", serif';
    ctx.fillText(String(year), W / 2, H / 2 + 80);
    // Subtitle
    ctx.fillStyle = COLORS.inkMid;
    ctx.font = '400 36px "Space Grotesk", sans-serif';
    ctx.fillText('Une année à vélo, en chiffres.', W / 2, H / 2 + 160);
    ctx.globalAlpha = 1;
  };
}

function metricScene(label: string, value: string, unit: string): Scene {
  return (ctx, t) => {
    const alpha = envelope(t);
    ctx.globalAlpha = alpha;
    // Tiny tag
    ctx.fillStyle = COLORS.terra;
    ctx.textAlign = 'center';
    ctx.font = '700 30px "Space Grotesk", sans-serif';
    ctx.fillText(`§ ${label}`, W / 2, H / 2 - 200);
    // Big number — animated count-up from 0 → final value during the
    // first 60 % of the scene.
    const numericRaw = parseInt(value.replace(/[^0-9]/g, ''), 10) || 0;
    const ease = Math.min(1, t / 0.6);
    const display = Math.round(numericRaw * (1 - Math.pow(1 - ease, 3))); // ease-out cubic
    const formatted = numericRaw > 0 ? formatNumber(display) : value;
    ctx.fillStyle = COLORS.ink;
    ctx.font = '900 320px "Playfair Display", serif';
    ctx.fillText(formatted, W / 2, H / 2 + 80);
    // Unit
    ctx.fillStyle = COLORS.inkMid;
    ctx.font = 'italic 700 44px "Playfair Display", serif';
    ctx.fillText(unit, W / 2, H / 2 + 170);
    ctx.globalAlpha = 1;
  };
}

function highlightScene(label: string, title: string, value: string): Scene {
  return (ctx, t) => {
    const alpha = envelope(t);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.terra;
    ctx.textAlign = 'center';
    ctx.font = '700 30px "Space Grotesk", sans-serif';
    ctx.fillText(`§ ${label}`, W / 2, H / 2 - 220);

    // Title — wrap-friendly (no fancy wrapping; assume short enough).
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 76px "Playfair Display", serif';
    const wrapped = wrapText(ctx, title, W - 200);
    let y = H / 2 - 60;
    for (const line of wrapped.slice(0, 2)) { // cap 2 lines
      ctx.fillText(line, W / 2, y);
      y += 92;
    }
    // Big value
    ctx.fillStyle = COLORS.terra;
    ctx.font = '900 180px "Playfair Display", serif';
    ctx.fillText(value, W / 2, H / 2 + 200);
    ctx.globalAlpha = 1;
  };
}

function outroScene(): Scene {
  return (ctx, t) => {
    const alpha = envelope(t);
    ctx.globalAlpha = alpha;
    // Brand
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.font = '900 100px "Playfair Display", serif';
    ctx.fillText('The Little', W / 2, H / 2 - 20);
    ctx.fillStyle = COLORS.terra;
    ctx.font = 'italic 900 100px "Playfair Display", serif';
    ctx.fillText('Explorer', W / 2, H / 2 + 80);
    // Tagline
    ctx.fillStyle = COLORS.inkMid;
    ctx.font = '400 32px "Space Grotesk", sans-serif';
    ctx.fillText('Sportivement vôtre.', W / 2, H / 2 + 180);
    ctx.globalAlpha = 1;
  };
}

// ── Backgrounds + chrome ──────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = COLORS.cream;
  ctx.fillRect(0, 0, W, H);
}

function drawFooter(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = COLORS.inkLight;
  ctx.font = '400 22px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('thelittleexplorer.app', W / 2, H - 60);
}

// ── Utilities ──────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4', // Safari ≥ 14.1 supports MediaRecorder MP4
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rafYield(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
