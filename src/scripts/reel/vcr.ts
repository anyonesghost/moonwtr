// VCR fast-forward / rewind overlay: low-res keyframes flashed under motion blur, tracking lines,
// chroma shift and noise, drawn on a small canvas that CSS scales up (so it looks like tape).

export interface KeySource {
  img: ImageBitmap | HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface VcrOptions {
  frames: KeySource[];
  dir: 1 | -1;
  msPerFrame: number;
  ready: Promise<unknown>; // resolves when the destination's real frames are decoded
  reduceMotion: boolean;
  letterbox: boolean; // vertical art on a wide screen: contain + darkened fill
}

const INTERNAL_SHORT = 400; // px on the short side of the internal canvas

export class Vcr {
  private ctx: CanvasRenderingContext2D;
  private prev: HTMLCanvasElement = document.createElement('canvas');
  private pctx = this.prev.getContext('2d')!;
  private roll = 0;
  running = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private label: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  }

  private fit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = INTERNAL_SHORT / Math.min(vw, vh);
    this.canvas.width = this.prev.width = Math.max(64, Math.round(vw * s));
    this.canvas.height = this.prev.height = Math.max(64, Math.round(vh * s));
  }

  private drawKey(k: KeySource, letterbox: boolean) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const ia = k.sw / k.sh;
    const va = W / H;
    if (letterbox && ia < va) {
      // darkened cover fill, then the contained picture on top
      const cw = W;
      const ch = W / ia;
      ctx.globalAlpha = 0.4;
      ctx.drawImage(k.img, k.sx, k.sy, k.sw, k.sh, 0, (H - ch) / 2, cw, ch);
      ctx.globalAlpha = 1;
      const w = H * ia;
      ctx.drawImage(k.img, k.sx, k.sy, k.sw, k.sh, (W - w) / 2, 0, w, H);
    } else {
      const s = Math.max(W / k.sw, H / k.sh);
      const w = k.sw * s;
      const h = k.sh * s;
      ctx.drawImage(k.img, k.sx, k.sy, k.sw, k.sh, (W - w) / 2, (H - h) / 2, w, h);
    }
  }

  /** Tape artefacts on the frame already drawn: tracking bands, chroma shift, noise, scanlines. */
  private damage(intensity: number) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const src = ctx.getImageData(0, 0, W, H);
    const out = ctx.createImageData(W, H);
    const a = src.data;
    const b = out.data;

    // Tracking bands: a few random ones plus one that rolls down the screen.
    const bands: { y: number; h: number; dx: number }[] = [];
    const nb = 2 + Math.floor(Math.random() * 3 * intensity);
    for (let i = 0; i < nb; i++) {
      bands.push({ y: Math.random() * H, h: 4 + Math.random() * 20, dx: (Math.random() - 0.5) * 90 * intensity });
    }
    this.roll = (this.roll + H * 0.045) % H;
    bands.push({ y: this.roll, h: 14, dx: (Math.random() - 0.5) * 60 });

    const shift = Math.round(2 + 2 * intensity);
    for (let y = 0; y < H; y++) {
      let dx = 0;
      let lift = 0;
      for (const band of bands) {
        if (y >= band.y && y < band.y + band.h) {
          dx = band.dx;
          lift = 26;
        }
      }
      const scan = y % 2 === 0 ? 1 : 0.86;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const sx = (((x + dx) | 0) + W * 4) % W;
        const rx = Math.min(W - 1, Math.max(0, sx + shift));
        const bx = Math.min(W - 1, Math.max(0, sx - shift));
        const n = (Math.random() - 0.5) * 36 * intensity + lift;
        const o = (row + x) * 4;
        b[o] = (a[(row + rx) * 4] + n) * scan;
        b[o + 1] = (a[(row + sx) * 4 + 1] + n) * scan;
        b[o + 2] = (a[(row + bx) * 4 + 2] + n) * scan;
        b[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  async play(opts: VcrOptions): Promise<void> {
    this.running = true;
    const { frames, dir, msPerFrame, ready, reduceMotion, letterbox } = opts;
    const canvas = this.canvas;
    this.fit();
    this.label.textContent = dir > 0 ? '▶▶  FF' : '◀◀  REW';
    this.label.classList.add('is-on');
    canvas.classList.add('is-on');

    // Reduced motion: no flashing frames, just a dip to black while the target loads.
    if (reduceMotion || frames.length === 0) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, canvas.width, canvas.height);
      await Promise.all([ready, new Promise((r) => setTimeout(r, 450))]);
      this.finish();
      return;
    }

    const t0 = performance.now();
    let minDone = false;
    let isReady = false;
    ready.then(() => (isReady = true), () => (isReady = true));
    const minMs = frames.length * msPerFrame;
    let lastStep = 0;

    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        const el = now - t0;
        if (el >= minMs) minDone = true;
        const k = Math.min(frames.length - 1, Math.floor(el / msPerFrame));

        // Tape cadence: re-damage the picture ~24 times a second, not at display rate.
        if (now - lastStep < 40) return void requestAnimationFrame(step);
        lastStep = now;

        // Motion blur: keep ghosts of the previous composed frame, smeared along the tape's travel.
        this.drawKey(frames[k], letterbox);
        const { ctx } = this;
        if (this.prev.width === canvas.width) {
          ctx.globalAlpha = 0.38;
          ctx.drawImage(this.prev, 0, dir * 10);
          ctx.globalAlpha = 0.2;
          ctx.drawImage(this.prev, 0, dir * 24);
          ctx.globalAlpha = 1;
        }
        // heavier damage in the first beat (tape engaging) and while waiting on the target
        const waiting = minDone && !isReady;
        const intensity = el < 220 ? 1.5 : waiting ? 1.25 : 0.9;
        this.damage(intensity);
        this.pctx.drawImage(canvas, 0, 0);

        if (minDone && isReady) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    this.finish();
  }

  private finish() {
    this.canvas.classList.remove('is-on');
    this.label.classList.remove('is-on');
    this.running = false;
  }
}
