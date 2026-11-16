// Per-piece hotspots (ported from scroll-test): markers pinned to the art from a Blender export,
// fading in as you approach, with lore cards that unfold beside them.
// A piece opts in with `hotspots` (the Blender export) + `markers` (what each empty is) in pieces.json.

import { smoothstep } from './timeline';

export type Kind = 'lore' | 'process';
export interface MarkerConfig {
  name: string; // Blender empty name
  kind: Kind;
  card: string; // file in <frames folder>/cards/<card>.webp
  reveal: [number, number]; // Blender frames over which the marker fades in
  frame: number; // rail position + when it flips outline -> filled (and fades out before)
}
type Spot = { x: number; y: number; depth?: number; visible: boolean; occluded?: boolean | null };
export type HotspotFile = { frames: Record<string, Record<string, Spot>> };
type Track = { x: number; y: number; depth: number; visible: boolean }[];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Marker {
  cfg: MarkerConfig;
  index: number; // pass frame (dot fills / fades out)
  railIndex: number; // rail circle: the moment the marker comes into view
  railPassed: boolean;
  track: Track;
  dot: HTMLButtonElement;
  stop: HTMLButtonElement;
  lore: HTMLElement;
  pose: HTMLElement;
  pop: HTMLElement;
  line: HTMLElement;
  passed: boolean;
  open: boolean;
}

export interface HotspotDeps {
  layer: HTMLElement; // dots + cards live here (inside the stage)
  railMain: HTMLElement; // rail circles live here
  stage: HTMLElement;
  frameIds: string[];
  data: HotspotFile | null;
  markers: MarkerConfig[];
  cardsUrl: string; // folder holding <card>.webp
  loreIcon: string;
  rect: () => Rect; // where the art is drawn (css px); the same rect the canvas uses
  gotoFrame: (index: number) => void; // scroll to a frame of this piece
  reduceMotion: () => boolean;
}

const EXIT_FADE = 24;
const CARD_ASPECT = 962 / 1920;
const CARD_MAX_TILT = 26;

export class PieceHotspots {
  private markers: Marker[] = [];
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.closeAll();
  };
  private onDoc = (e: MouseEvent) => {
    if (!(e.target as Element).closest('.hotspot, .lore__pose, .rail__stop')) this.closeAll();
  };

  constructor(private d: HotspotDeps) {
    const n = d.frameIds.length;
    for (const cfg of d.markers) {
      const index = this.nearestIndex(cfg.frame);
      // The rail circle marks when the marker appears (midpoint of its fade-in), not when it leaves.
      const railIndex = this.nearestIndex(Math.round((cfg.reveal[0] + cfg.reveal[1]) / 2));

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `hotspot kind-${cfg.kind}`;
      dot.tabIndex = -1;
      dot.setAttribute('aria-label', `${cfg.name}: open ${cfg.kind === 'lore' ? 'lore card' : 'details'}`);
      dot.setAttribute('aria-expanded', 'false');
      dot.innerHTML =
        cfg.kind === 'lore'
          ? `<span class="hotspot__dot hotspot__dot--lore"><img class="hotspot__icon" src="${d.loreIcon}" alt="" draggable="false"></span><span class="hotspot__label"></span>`
          : `<span class="hotspot__dot"></span><span class="hotspot__label"></span>`;
      dot.querySelector('.hotspot__label')!.textContent = cfg.name;
      d.layer.append(dot);

      const lore = document.createElement('div');
      lore.className = `lore kind-${cfg.kind}`;
      lore.innerHTML = `<div class="lore__line"></div><div class="lore__pose"><div class="lore__pop"><img class="lore__img" alt="" draggable="false"></div></div>`;
      const img = lore.querySelector('img')!;
      img.alt = cfg.name;
      img.src = `${d.cardsUrl}/${cfg.card}.webp`;
      d.layer.append(lore);

      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = `rail__stop kind-${cfg.kind}`;
      stop.style.top = `${(railIndex / (n - 1)) * 100}%`;
      stop.setAttribute('aria-label', `${cfg.name}: jump to frame ${d.frameIds[railIndex]}`);
      stop.innerHTML = `<span class="rail__label"></span>`;
      stop.querySelector('.rail__label')!.textContent = cfg.name;
      stop.addEventListener('pointerdown', (e) => e.stopPropagation());
      stop.addEventListener('click', () => d.gotoFrame(railIndex));
      d.railMain.querySelector('.rail__stops')!.append(stop);

      const m: Marker = {
        cfg,
        index,
        railIndex,
        railPassed: false,
        track: this.buildTrack(cfg.name),
        dot,
        stop,
        lore,
        pose: lore.querySelector('.lore__pose') as HTMLElement,
        pop: lore.querySelector('.lore__pop') as HTMLElement,
        line: lore.querySelector('.lore__line') as HTMLElement,
        passed: false,
        open: false,
      };
      dot.addEventListener('click', () => this.setOpen(m, !m.open));
      m.pose.addEventListener('click', () => this.setOpen(m, false));
      this.markers.push(m);
    }
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('click', this.onDoc);
  }

  private nearestIndex(frame: number) {
    let best = 0;
    this.d.frameIds.forEach((id, i) => {
      if (Math.abs(Number(id) - frame) < Math.abs(Number(this.d.frameIds[best]) - frame)) best = i;
    });
    return best;
  }

  // Per-frame screen positions for one empty. The export may cover only some frames, so gaps are
  // interpolated between the nearest exported frames and the last position is held (never extrapolated).
  private buildTrack(name: string): Track {
    const keyed: { f: number; s: Spot }[] = [];
    for (const [f, entry] of Object.entries(this.d.data?.frames ?? {})) {
      if (entry[name]) keyed.push({ f: Number(f), s: entry[name] });
    }
    keyed.sort((a, b) => a.f - b.f);
    if (!keyed.length) return this.d.frameIds.map(() => ({ x: 0, y: 0, depth: 1, visible: false }));

    const pt = (s: Spot) => ({ x: s.x, y: s.y, depth: s.depth ?? 1, visible: s.visible });
    return this.d.frameIds.map((id) => {
      const f = Number(id);
      const hi = keyed.findIndex((k) => k.f >= f);
      if (hi === -1) return pt(keyed[keyed.length - 1].s);
      const b = keyed[hi];
      const a = keyed[Math.max(0, hi - 1)];
      if (a === b || b.f === f) return pt(b.s);
      if (f < a.f) return pt(a.s);
      const t = (f - a.f) / (b.f - a.f);
      const da = a.s.depth ?? 1;
      const db = b.s.depth ?? 1;
      return {
        x: a.s.x + (b.s.x - a.s.x) * t,
        y: a.s.y + (b.s.y - a.s.y) * t,
        depth: da + (db - da) * t,
        visible: a.s.visible && b.s.visible, // off-screen coordinates are junk, so need both ends valid
      };
    });
  }

  private setOpen(m: Marker, open: boolean) {
    if (open) for (const o of this.markers) if (o !== m) this.setOpen(o, false);
    if (m.open === open) return;
    m.open = open;
    m.lore.classList.toggle('is-open', open);
    m.dot.setAttribute('aria-expanded', String(open));
  }

  closeAll() {
    this.markers.forEach((m) => this.setOpen(m, false));
  }

  // Where the card sits and how it's posed. The one place to swap in projected plane corners later.
  private layoutCard(px: number, py: number, depth: number) {
    const sw = this.d.stage.clientWidth;
    const sh = this.d.stage.clientHeight;
    const railRoom = 48;
    const narrow = sw < 768;
    const base = Math.min(Math.max(sw * 0.4, 300), 640);
    const nearness = Math.min(1.35, Math.max(0.7, 7 / Math.max(depth, 0.5)));
    const w = narrow ? sw - railRoom - 16 : Math.min(base * nearness, sw - railRoom - 16);
    const ht = w * CARD_ASPECT;
    const gap = 30;
    let x: number;
    let y: number;
    if (px + gap + w <= sw - railRoom) {
      x = px + gap;
      y = py - ht / 2;
    } else if (px - gap - w >= 8) {
      x = px - gap - w;
      y = py - ht / 2;
    } else {
      x = Math.min(Math.max(px - w / 2, 8), sw - railRoom - w);
      y = py - gap - ht >= 8 ? py - gap - ht : py + gap;
    }
    y = Math.min(Math.max(y, 8), sh - ht - 8);
    const cx = x + w / 2;
    const cy = y + ht / 2;
    const still = this.d.reduceMotion();
    const ry = still ? 0 : ((cx - sw / 2) / (sw / 2)) * CARD_MAX_TILT;
    const rx = still ? 0 : -((cy - sh / 2) / (sh / 2)) * (CARD_MAX_TILT * 0.5);
    return { x, y, w, ht, ry, rx };
  }

  /** Call every tick with the displayed frame index. */
  update(index: number) {
    const r = this.d.rect();
    const sw = this.d.stage.clientWidth;
    const sh = this.d.stage.clientHeight;
    const f = Number(this.d.frameIds[index]);
    for (const m of this.markers) {
      const t = m.track[index];
      const px = r.x + t.x * r.w;
      const py = r.y + t.y * r.h;
      const inStage = px >= 8 && px <= sw - 8 && py >= 8 && py <= sh - 8;
      const edge = Math.min(1, Math.max(0, (Math.min(px, sw - px, py, sh - py) - 8) / 48));
      const alpha =
        t.visible && inStage
          ? smoothstep(m.cfg.reveal[0], m.cfg.reveal[1], f) * (1 - smoothstep(m.cfg.frame - EXIT_FADE, m.cfg.frame, f)) * edge
          : 0;
      const show = alpha > 0.4;
      m.dot.style.opacity = alpha.toFixed(3);
      m.dot.classList.toggle('is-visible', show);
      m.dot.tabIndex = show ? 0 : -1;
      m.dot.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;

      if (alpha < 0.05 && m.open) this.setOpen(m, false);

      if (m.open || m.lore.classList.contains('is-open')) {
        const c = this.layoutCard(px, py, t.depth);
        m.lore.style.width = `${c.w.toFixed(1)}px`;
        m.lore.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
        m.pose.style.transform = `perspective(900px) rotateY(${c.ry.toFixed(2)}deg) rotateX(${c.rx.toFixed(2)}deg)`;
        m.pop.style.transformOrigin = `${(px - c.x).toFixed(1)}px ${(py - c.y).toFixed(1)}px`;
        m.pop.style.setProperty('--pop-spin', `${c.ry >= 0 ? 40 : -40}deg`);
        const ex = Math.min(Math.max(px, c.x), c.x + c.w);
        const ey = Math.min(Math.max(py, c.y), c.y + c.ht);
        const dx = ex - px;
        const dy = ey - py;
        m.line.style.left = `${(px - c.x).toFixed(1)}px`;
        m.line.style.top = `${(py - c.y).toFixed(1)}px`;
        m.line.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
        m.line.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
      }

      const passed = index >= m.index;
      if (passed !== m.passed) {
        m.passed = passed;
        m.dot.classList.toggle('is-passed', passed);
      }
      const railPassed = index >= m.railIndex;
      if (railPassed !== m.railPassed) {
        m.railPassed = railPassed;
        m.stop.classList.toggle('is-passed', railPassed);
      }
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('click', this.onDoc);
    for (const m of this.markers) {
      m.dot.remove();
      m.lore.remove();
      m.stop.remove();
    }
    this.markers = [];
  }
}
