// Film grain: noise is generated once into a few small tiles. Each "frame" of grain tiles one of them
// across a physical-pixel canvas at a random offset, at film cadence (not every rAF).

export interface GrainParams {
  opacity: number;
  size: number; // physical px per noise px
  fps: number;
  blend: string;
}

const TILE = 256;
const TILES = 8;

export function initGrain(canvas: HTMLCanvasElement, params: GrainParams, reduceMotion: MediaQueryList) {
  const gctx = canvas.getContext('2d')!;
  const tiles: HTMLCanvasElement[] = [];
  let raf = 0;
  let last = 0;
  let index = 0;

  // Gaussian-ish noise (sum of uniforms), lightly blurred (wrapped, so tiles are seamless) so it clumps
  // like silver halide rather than TV static. Luminance only, centred on mid-grey.
  for (let t = 0; t < TILES; t++) {
    const raw = new Float32Array(TILE * TILE);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.random() + Math.random() + Math.random() + Math.random() - 2;
    const soft = new Float32Array(TILE * TILE);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const xm = (x + TILE - 1) % TILE;
        const xp = (x + 1) % TILE;
        const ym = (y + TILE - 1) % TILE;
        const yp = (y + 1) % TILE;
        soft[y * TILE + x] =
          (raw[y * TILE + x] * 4 + raw[y * TILE + xm] + raw[y * TILE + xp] + raw[ym * TILE + x] + raw[yp * TILE + x]) / 8;
      }
    }
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const cctx = c.getContext('2d')!;
    const img = cctx.createImageData(TILE, TILE);
    for (let i = 0; i < soft.length; i++) {
      const v = Math.max(0, Math.min(255, 128 + soft[i] * 95));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    cctx.putImageData(img, 0, 0);
    tiles.push(c);
  }

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function draw(i: number, still = false) {
    const w = canvas.width;
    const h = canvas.height;
    const foot = TILE * params.size;
    const ox = still ? 0 : -Math.random() * foot;
    const oy = still ? 0 : -Math.random() * foot;
    gctx.imageSmoothingEnabled = params.size % 1 !== 0;
    const tile = tiles[i];
    for (let r = 0; oy + r * foot < h; r++) {
      const y0 = Math.round(oy + r * foot);
      const y1 = Math.round(oy + (r + 1) * foot);
      for (let c = 0; ox + c * foot < w; c++) {
        const x0 = Math.round(ox + c * foot);
        const x1 = Math.round(ox + (c + 1) * foot);
        gctx.drawImage(tile, x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / params.fps - 2) return;
    last = now;
    index = (index + 1) % TILES;
    draw(index);
  }

  function apply() {
    canvas.style.opacity = String(params.opacity);
    canvas.style.mixBlendMode = params.blend;
    if (reduceMotion.matches) draw(0, true);
  }

  function start() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (reduceMotion.matches) draw(0, true); // one static tile, no animation
    else if (!document.hidden) raf = requestAnimationFrame(loop);
  }

  size();
  apply();
  start();
  document.addEventListener('visibilitychange', start);
  reduceMotion.addEventListener('change', start);
  window.addEventListener('resize', () => {
    size();
    draw(index, reduceMotion.matches);
  });

  return { apply };
}
