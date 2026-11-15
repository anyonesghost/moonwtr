// One piece's frames: every frame's compressed bytes are kept (cheap), but only a window of frames
// around the playhead (plus a few anchors) is decoded to bitmaps (expensive: 8 MB each at native size).

export type Variant = 'desktop' | 'mobile';

export interface StoreManifest {
  id?: string;
  frames: string[]; // zero-padded Blender frame ids, in playback order
  variants: Record<string, { width: number; height: number }>;
  keys?: { count: number; cellWidth: number; cellHeight: number };
}

const FETCH_CONCURRENCY = 6;
const MAX_DECODES = 3;
const ANCHOR_STEP = 48; // frames kept decoded permanently as a fallback while scrubbing fast
const WINDOW = 12; // frames decoded either side of the playhead

export class FrameStore {
  readonly n: number;
  blobs: (Blob | null)[];
  blobCount = 0;
  readonly bitmaps = new Map<number, ImageBitmap>();
  private inflight = new Set<number>();
  private wanted = new Set<number>();
  private decoding = 0;
  private queue: number[] = [];
  private prioAt = 0;
  private token = 0;
  private fetching = false;

  constructor(
    readonly folderUrl: string, // e.g. /lab/reel/the-nest
    readonly manifest: StoreManifest,
    readonly variant: Variant,
  ) {
    this.n = manifest.frames.length;
    this.blobs = new Array(this.n).fill(null);
  }

  get dims() {
    return this.manifest.variants[this.variant] ?? Object.values(this.manifest.variants)[0];
  }

  private anchors(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n; i += ANCHOR_STEP) out.push(i);
    if (out[out.length - 1] !== this.n - 1) out.push(this.n - 1);
    return out;
  }

  /** Begin fetching bytes: anchors first, then outward from `focus`. Safe to call twice. */
  start(focus = 0) {
    if (this.fetching) return;
    this.fetching = true;
    const token = ++this.token;
    const anchors = this.anchors();
    const rest = [...Array(this.n).keys()].filter((i) => !anchors.includes(i));
    rest.sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus));
    this.queue = [...anchors, ...rest];
    this.prioAt = focus;

    const worker = async () => {
      while (this.queue.length && token === this.token) {
        const i = this.queue.shift()!;
        if (this.blobs[i]) continue;
        try {
          const res = await fetch(`${this.folderUrl}/frames/${this.variant}/${this.manifest.frames[i]}.webp`);
          if (!res.ok) continue; // missing frame: the nearest decoded one is drawn instead
          const blob = await res.blob();
          if (token !== this.token) return;
          this.blobs[i] = blob;
          this.blobCount++;
        } catch {
          /* network hiccup: skip */
        }
      }
    };
    for (let i = 0; i < FETCH_CONCURRENCY; i++) worker();
  }

  /** Decode what's needed around `index`; close what isn't. `window`/`anchors` shrink this for warm-ups. */
  pump(index: number, window = WINDOW, keepAnchors = true) {
    const want: number[] = [];
    const seen = new Set<number>();
    const add = (i: number) => {
      if (i >= 0 && i < this.n && !seen.has(i)) {
        seen.add(i);
        want.push(i);
      }
    };
    for (let d = 0; d <= window; d++) {
      add(index + d);
      add(index - d);
    }
    if (keepAnchors) this.anchors().forEach(add);
    this.wanted = seen;

    // Jumped far (rail drag, link): fetch the new neighbourhood first.
    if (Math.abs(index - this.prioAt) > 24 && this.queue.length) {
      this.prioAt = index;
      this.queue.sort((a, b) => Math.abs(a - index) - Math.abs(b - index));
    }

    for (const [i, bm] of this.bitmaps) {
      if (!seen.has(i)) {
        bm.close();
        this.bitmaps.delete(i);
      }
    }

    const token = this.token;
    for (const i of want) {
      if (this.decoding >= MAX_DECODES) break;
      const blob = this.blobs[i];
      if (!blob || this.bitmaps.has(i) || this.inflight.has(i)) continue;
      this.inflight.add(i);
      this.decoding++;
      createImageBitmap(blob)
        .then((bm) => {
          if (token !== this.token || !this.wanted.has(i)) return bm.close();
          this.bitmaps.set(i, bm);
          this.onDecoded?.(i);
        })
        .catch(() => {})
        .finally(() => {
          if (token !== this.token) return;
          this.inflight.delete(i);
          this.decoding--;
        });
    }
  }

  onDecoded?: (i: number) => void;

  /** Nearest decoded frame to `i`, or null while nothing is decoded yet. */
  nearest(i: number): { index: number; bitmap: ImageBitmap } | null {
    const exact = this.bitmaps.get(i);
    if (exact) return { index: i, bitmap: exact };
    for (let d = 1; d < this.n; d++) {
      const a = this.bitmaps.get(i - d);
      if (a) return { index: i - d, bitmap: a };
      const b = this.bitmaps.get(i + d);
      if (b) return { index: i + d, bitmap: b };
    }
    return null;
  }

  has(i: number) {
    return this.bitmaps.has(i);
  }

  /** Free decoded bitmaps but keep the bytes, so scrolling back is instant. */
  release() {
    for (const bm of this.bitmaps.values()) bm.close();
    this.bitmaps.clear();
    this.wanted.clear();
  }

  /** Free everything and stop fetching. */
  dispose() {
    this.token++;
    this.fetching = false;
    this.queue = [];
    this.release();
    this.inflight.clear();
    this.decoding = 0;
    this.blobs = new Array(this.n).fill(null);
    this.blobCount = 0;
  }
}
