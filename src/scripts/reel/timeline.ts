// Scroll timeline for the reel: one tall page, cut into segments per piece.
//   title -> scrub -> dwell -> dip   (repeated per piece)   ... then one end card.
// Lengths are in vh (scaled to the viewport) so the pacing is the same on any screen.

export const FPS = 24;
export type Phase = 'title' | 'scrub' | 'dwell' | 'dip' | 'end';

export interface Segment {
  piece: number; // index into pieces; the end card uses pieces.length
  phase: Phase;
  start: number; // scroll px where the segment begins
  len: number; // scroll px
  vStart: number; // virtual timecode frames where the segment begins
  vLen: number;
}

export interface Timeline {
  segs: Segment[];
  range: number; // scrollable distance (px)
  total: number; // page height (px) = range + one viewport
  vTotal: number; // total virtual frames
  pieceStart: number[]; // scroll px of each piece's title card
  pieceVStart: number[];
  pieceVLen: number[];
  endStart: number;
  scrub: Segment[]; // the scrub segment of each piece
}

/** Scroll distance per phase, in vh. `perFrame` is per scrubbed frame. */
export const VH = { title: 130, dwell: 70, dip: 60, end: 150, perFrame: 2.2 };
/** What each phase counts for on the VCR timecode, in 24 fps frames. */
export const VF = { title: 72, dwell: 48, dip: 24, end: 96 };

export function buildTimeline(frameCounts: number[], viewportH: number): Timeline {
  const px = (vh: number) => (vh / 100) * viewportH;
  const segs: Segment[] = [];
  const pieceStart: number[] = [];
  const pieceVStart: number[] = [];
  const pieceVLen: number[] = [];
  const scrub: Segment[] = [];
  let y = 0;
  let v = 0;
  const push = (piece: number, phase: Phase, len: number, vLen: number) => {
    const seg = { piece, phase, start: y, len, vStart: v, vLen };
    segs.push(seg);
    y += len;
    v += vLen;
    return seg;
  };

  frameCounts.forEach((n, i) => {
    pieceStart.push(y);
    pieceVStart.push(v);
    push(i, 'title', px(VH.title), VF.title);
    scrub.push(push(i, 'scrub', px(n * VH.perFrame), n));
    push(i, 'dwell', px(VH.dwell), VF.dwell);
    push(i, 'dip', px(VH.dip), VF.dip);
    pieceVLen.push(v - pieceVStart[i]);
  });
  const endStart = y;
  push(frameCounts.length, 'end', px(VH.end), VF.end);

  return { segs, range: y, total: y + viewportH, vTotal: v, pieceStart, pieceVStart, pieceVLen, endStart, scrub };
}

/** Which segment a scroll position falls in, and how far through it (0-1). */
export function locate(tl: Timeline, y: number): { seg: Segment; t: number } {
  const yy = Math.min(Math.max(y, 0), tl.range);
  let lo = 0;
  let hi = tl.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.segs[mid].start <= yy) lo = mid;
    else hi = mid - 1;
  }
  const seg = tl.segs[lo];
  const t = seg.len > 0 ? Math.min(1, Math.max(0, (yy - seg.start) / seg.len)) : 1;
  return { seg, t };
}

export function timecode(vFrames: number): string {
  const f = Math.max(0, Math.floor(vFrames));
  const ff = f % FPS;
  const s = Math.floor(f / FPS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(ff)}`;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
