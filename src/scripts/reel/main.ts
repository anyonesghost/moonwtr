// The reel: pieces play in order. Each piece is a title card fading up from black, a scroll-scrubbed
// sequence, a dwell on the last frame, then a dip to black. After the last piece, an end card.
// Page structure and styles live in src/pages/lab/reel.astro; this file drives them.

import { FrameStore, type StoreManifest, type Variant } from './frame-store';
import { initGrain, type GrainParams } from './grain';
import { PieceHotspots, type HotspotFile, type MarkerConfig, type Rect } from './hotspots';
import { buildTimeline, locate, smoothstep as ss, timecode, VH, type Phase, type Timeline } from './timeline';
import { Vcr, type KeySource } from './vcr';

interface Piece {
  id: string;
  title: string;
  year: string;
  medium: string;
  hook: string;
  frames: string; // folder under public/, e.g. lab/reel/the-nest
  frameCount: number;
  orientation: 'vertical' | 'horizontal';
  hotspots?: string | null; // Blender hotspot export (path under public/)
  markers?: MarkerConfig[];
}

// Touch speed limit: the drawn playhead can't travel faster than this many scrub frames per second,
// however hard the page is flicked (phone momentum scrolling would otherwise skip whole pieces).
// The reel plays at 24 fps, so 48 = twice real time. Raise it for a looser feel, lower to slow it.
const TOUCH_MAX_FPS = 48;
// ...and, on every device, a title card can't be crossed faster than this, so momentum lands on it.
const TOUCH_TITLE_MIN_SECONDS = 2.5;
// How far (in screens) the scroll position may run ahead of the playhead while a title card is held.
const TITLE_MAX_LEAD = 0.5;
const SMOOTHING = 0.22; // 1 = no easing between scroll position and what's drawn
const GRAIN: GrainParams = { opacity: 0.19, size: 1, fps: 18, blend: 'hard-light' };

export function start() {
  const $ = (id: string) => document.getElementById(id)!;
  const BASE = (document.body.dataset.base ?? '').replace(/\/$/, '');
  const MEDIA = (document.body.dataset.media ?? BASE).replace(/\/$/, '');
  const url = (rel: string) => `${MEDIA}/${rel.replace(/^\//, '')}`;
  const LORE_ICON = `${BASE}/icons/Lore%20Marker.png`;
  const pieces: Piece[] = JSON.parse($('pieces-data').textContent || '[]');
  const N = pieces.length;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileMQ = window.matchMedia('(max-width: 768px)');

  const scroller = $('scroller');
  const stage = $('stage');
  const art = $('art') as HTMLCanvasElement;
  const actx = art.getContext('2d')!;
  actx.imageSmoothingQuality = 'high';
  const bg = $('bg') as HTMLCanvasElement;
  const bctx = bg.getContext('2d')!;
  const fade = $('fade');
  const titleEl = $('titleCard');
  const cueEl = $('titleCue');
  const cueFill = $('titleCueFill');
  const cueText = $('titleCueText');
  const endEl = $('endCard');
  const hotspotLayer = $('hotspots');
  const rail = $('rail');
  const railBefore = $('railBefore');
  const railAfter = $('railAfter');
  const railMain = $('railMain');
  const railFill = $('railFill');
  const osd = $('osd');
  const osdMode = $('osdMode');
  const osdTc = $('osdTc');
  const osdPiece = $('osdPiece');
  const tape = $('tape');
  const indexBtn = $('indexBtn');
  const hud = $('hud');
  const vcr = new Vcr($('vcr') as HTMLCanvasElement, $('vcrLabel'));

  // ------------------------------------------------------------------ state
  let tl: Timeline = buildTimeline(pieces.map((p) => p.frameCount), window.innerHeight);
  let variant: Variant = mobileMQ.matches ? 'mobile' : 'desktop';
  const stores = new Map<number, FrameStore>();
  const loading = new Set<number>();
  const failed = new Set<number>();
  const manifests = new Map<number, Promise<StoreManifest | null>>();
  const strips = new Map<number, Promise<{ img: ImageBitmap; count: number } | null>>();

  let smoothY = 0;
  let lastNow = 0;
  const coarse = window.matchMedia('(pointer: coarse)');
  let lastY = 0;
  let lastMoveAt = 0;
  let displayV = 0;
  let transition = false;
  let curSeg = { piece: -1, phase: '' as Phase | '' };
  let curPiece = 0; // piece the UI is showing (the end card counts as the last piece)
  let titleEnteredAt = performance.now();
  let hot: { piece: number; h: PieceHotspots } | null = null;
  let hashSynced = '';
  let rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let letterbox = false;
  let drawnKey = '';
  let dirty = true;
  let lastTc = '';
  let lastMode = '';
  let debugOn = false;
  let hudAt = 0;

  // ------------------------------------------------------------------ loading
  const manifestFor = (i: number) => {
    if (!manifests.has(i)) {
      manifests.set(
        i,
        fetch(`${url(pieces[i].frames)}/frames/manifest.json`)
          .then((r) => (r.ok ? (r.json() as Promise<StoreManifest>) : null))
          .catch(() => null),
      );
    }
    return manifests.get(i)!;
  };

  /** Kick off (once) the store for piece i. Returns right away; `stores` fills in when ready. */
  function wantStore(i: number) {
    if (i < 0 || i >= N || stores.has(i) || loading.has(i) || failed.has(i)) return;
    loading.add(i);
    manifestFor(i).then((m) => {
      loading.delete(i);
      if (!m) {
        failed.add(i);
        return;
      }
      const s = new FrameStore(url(pieces[i].frames), m, variant);
      s.onDecoded = () => (dirty = true);
      stores.set(i, s);
      s.start(0);
    });
  }

  function dropStore(i: number) {
    stores.get(i)?.dispose();
    stores.delete(i);
  }

  // Keyframe strips for the VCR transition (tiny; loaded up front).
  function stripFor(i: number) {
    if (!strips.has(i)) {
      strips.set(
        i,
        fetch(`${url(pieces[i].frames)}/keys.webp`)
          .then((r) => (r.ok ? r.blob() : Promise.reject()))
          .then((b) => createImageBitmap(b))
          .then((img) => ({ img, count: 8 }))
          .catch(() => null),
      );
    }
    return strips.get(i)!;
  }

  // ------------------------------------------------------------------ layout
  function aspectOf(i: number) {
    const d = stores.get(i)?.dims;
    return d ? d.width / d.height : pieces[i].orientation === 'vertical' ? 9 / 16 : 16 / 9;
  }

  function layout(i: number) {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const a = aspectOf(i);
    // Vertical art on a wide screen: centred, with a blurred, darkened copy filling the sides.
    letterbox = a < (W / H) * 0.85;
    const s = letterbox ? Math.min(W / a, H) : Math.max(W / a, H);
    const h = s;
    const w = s * a;
    rect = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    stage.classList.toggle('is-letterbox', letterbox);
    dirty = true;
  }

  function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    art.width = Math.round(stage.clientWidth * dpr);
    art.height = Math.round(stage.clientHeight * dpr);
    bg.width = 96;
    bg.height = Math.max(32, Math.round((96 * stage.clientHeight) / stage.clientWidth));
    dirty = true;
  }

  function paint(bitmap: ImageBitmap) {
    const k = art.width / stage.clientWidth;
    actx.clearRect(0, 0, art.width, art.height);
    actx.drawImage(bitmap, rect.x * k, rect.y * k, rect.w * k, rect.h * k);
    if (letterbox) {
      // cover-fit the same frame into the small background canvas; CSS blurs + darkens it
      const s = Math.max(bg.width / bitmap.width, bg.height / bitmap.height);
      const w = bitmap.width * s;
      const h = bitmap.height * s;
      bctx.drawImage(bitmap, (bg.width - w) / 2, (bg.height - h) / 2, w, h);
    }
  }

  // ------------------------------------------------------------------ chrome (rail, OSD, title, hash)
  function pieceLabel(i: number) {
    return `${String(i + 1).padStart(2, '0')} ${pieces[i].title}`;
  }

  function buildRail(c: number, atEnd: boolean) {
    const seg = (i: number, done: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `rail__seg${done ? ' is-done' : ''}`;
      const name = i >= N ? 'End card' : pieceLabel(i);
      b.title = name;
      b.setAttribute('aria-label', `Go to ${name}`);
      b.addEventListener('click', () => travel(i));
      return b;
    };
    railBefore.replaceChildren(...Array.from({ length: c }, (_, i) => seg(i, true)));
    const after: HTMLElement[] = [];
    for (let i = c + 1; i < N; i++) after.push(seg(i, false));
    after.push(seg(N, atEnd));
    railAfter.replaceChildren(...after);
  }

  function setTitle(i: number) {
    const p = pieces[i];
    $('titleIdx').textContent = `${String(i + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    $('titleName').textContent = p.title;
    $('titleMeta').textContent = `${p.year}  ·  ${p.medium}`;
    $('titleHook').textContent = p.hook;
  }

  function syncHash(h: string) {
    if (h === hashSynced) return;
    hashSynced = h;
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function onPieceChange(i: number, atEnd: boolean) {
    curPiece = i;
    setTitle(i);
    buildRail(i, atEnd);
    osdPiece.textContent = atEnd ? 'END' : pieceLabel(i);
    tape.querySelectorAll<HTMLElement>('[data-i]').forEach((el) => {
      if (Number(el.dataset.i) === i) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
    // hotspots belong to one piece
    hot?.h.destroy();
    hot = null;
    wantStore(i);
    layout(i);
    buildHotspots(i);
  }

  async function buildHotspots(i: number) {
    const p = pieces[i];
    if (!p.hotspots || !p.markers?.length) return;
    const [m, data] = await Promise.all([
      manifestFor(i),
      fetch(url(p.hotspots))
        .then((r) => (r.ok ? (r.json() as Promise<HotspotFile>) : null))
        .catch(() => null),
    ]);
    if (!m || curPiece !== i) return; // moved on while loading
    hot?.h.destroy();
    hot = {
      piece: i,
      h: new PieceHotspots({
        layer: hotspotLayer,
        railMain,
        stage,
        frameIds: m.frames,
        data,
        markers: p.markers!,
        cardsUrl: `${url(p.frames)}/cards`,
        loreIcon: LORE_ICON,
        rect: () => rect,
        gotoFrame: (idx) => {
          const sc = tl.scrub[i];
          window.scrollTo({ top: sc.start + (idx / (m.frames.length - 1)) * sc.len, behavior: reduce.matches ? 'instant' : 'smooth' });
        },
        reduceMotion: () => reduce.matches,
      }),
    };
  }

  // ------------------------------------------------------------------ the frame loop
  function tick(now: number) {
    requestAnimationFrame(tick);

    const dt = Math.min(0.1, Math.max(0.001, (now - (lastNow || now - 16.7)) / 1000));
    lastNow = now;
    const target = window.scrollY;
    const d = target - smoothY;
    let stepY = d * SMOOTHING;
    // Speed limits (any input): a title card can't be crossed faster than TOUCH_TITLE_MIN_SECONDS,
    // so momentum from the previous piece lands on it. Touch screens also get the overall frame-rate cap.
    let pxPerSec = Infinity;
    if (coarse.matches) pxPerSec = TOUCH_MAX_FPS * (VH.perFrame / 100) * window.innerHeight;
    if (locate(tl, smoothY).seg.phase === 'title') {
      pxPerSec = Math.min(pxPerSec, ((VH.title / 100) * window.innerHeight) / TOUCH_TITLE_MIN_SECONDS);
    }
    const cap = pxPerSec * dt;
    stepY = Math.max(-cap, Math.min(cap, stepY));
    // A big step (desktop trackpad momentum) can jump clean over a title card in one frame, so stop at
    // its edge first; from there the limit above meters the crossing.
    for (const sg of tl.segs) {
      if (sg.phase !== 'title') continue;
      const a = sg.start;
      const b = sg.start + sg.len;
      if (smoothY < a && smoothY + stepY > a) { stepY = a - smoothY + 0.5; break; }
      if (smoothY >= b && smoothY + stepY < b) { stepY = b - 0.5 - smoothY; break; }
    }
    smoothY = reduce.matches || Math.abs(d) < 0.5 ? target : smoothY + stepY;
    // While a title card is held, don't let the scroll position run far ahead of (or behind) the playhead:
    // scrolling during the hold would otherwise pile up and spring through the whole piece afterwards.
    if (!reduce.matches && !transition && locate(tl, smoothY).seg.phase === 'title') {
      const maxLead = window.innerHeight * TITLE_MAX_LEAD;
      const lead = target - smoothY;
      if (Math.abs(lead) > maxLead) window.scrollTo({ top: smoothY + Math.sign(lead) * maxLead, behavior: 'instant' });
    }
    const vel = smoothY - lastY;
    lastY = smoothY;
    if (Math.abs(vel) > 0.8) lastMoveAt = now;

    const { seg, t } = locate(tl, smoothY);
    const atEnd = seg.phase === 'end';
    const pi = Math.min(seg.piece, N - 1);

    if (seg.piece !== curSeg.piece || seg.phase !== curSeg.phase) {
      const pieceChanged = pi !== curPiece || curSeg.piece === -1 || atEnd !== (curSeg.phase === 'end');
      if (seg.phase === 'title') titleEnteredAt = now;
      curSeg = { piece: seg.piece, phase: seg.phase };
      if (pieceChanged) onPieceChange(pi, atEnd);
      if (!transition) syncHash(atEnd ? '#end' : `#${pieces[pi].id}`);
    }

    // store housekeeping: current + next (once we're near the end of this piece), keep the previous
    wantStore(pi);
    const near = seg.phase === 'dwell' || seg.phase === 'dip' || atEnd || (seg.phase === 'scrub' && t > 0.55);
    if (near) wantStore(pi + 1);
    const cs = stores.get(pi);
    if (cs && cs.blobCount >= cs.n * 0.95) wantStore(pi + 1);
    for (const i of [...stores.keys()]) if (i < pi - 1 || i > pi + 1) dropStore(i);

    // what to show
    const n = pieces[pi].frameCount;
    let level = 0; // how bright the art is (rest is black)
    let titleOp = 0;
    let endOp = 0;
    let frame = 0;
    switch (seg.phase) {
      case 'title': {
        // fades up on its own after arriving (time), or as you scroll (whichever is further along)
        const ramp = Math.min(1, (now - titleEnteredAt) / 1800) * 0.5;
        const tt = Math.max(t, ramp);
        level = 0.38 * ss(0.08, 0.5, tt) + 0.62 * ss(0.72, 1, t);
        titleOp = ss(0.05, 0.35, tt) * (1 - ss(0.72, 0.95, t));
        frame = 0;
        break;
      }
      case 'scrub':
        level = 1;
        frame = Math.round(t * (n - 1));
        break;
      case 'dwell':
        level = 1;
        frame = n - 1;
        break;
      case 'dip':
        level = 1 - ss(0, 1, t);
        frame = n - 1;
        break;
      case 'end':
        endOp = ss(0.1, 0.5, t);
        break;
    }
    fade.style.opacity = (1 - level).toFixed(3);
    titleEl.style.opacity = titleOp.toFixed(3);
    // scroll cue on every title card: the ring fills with progress through the card
    const cueOn = seg.phase === 'title';
    cueEl.classList.toggle('is-on', cueOn);
    if (cueOn) {
      cueFill.style.strokeDashoffset = (100 - t * 100).toFixed(2);
      const msg = pi === 0 ? 'Scroll to start The Survey' : 'Scroll to continue';
      if (cueText.textContent !== msg) cueText.textContent = msg;
    }
    endEl.style.opacity = endOp.toFixed(3);
    endEl.classList.toggle('is-live', endOp > 0.5);

    // draw
    if (!atEnd && cs) {
      cs.pump(frame);
      const key = `${pi}:${frame}`;
      if (key !== drawnKey || dirty) {
        const hit = cs.nearest(frame);
        if (hit) {
          if (dirty && aspectOf(pi) !== rect.w / rect.h) layout(pi); // real dimensions arrived
          paint(hit.bitmap);
          drawnKey = key;
          dirty = false;
        }
      }
    } else if (atEnd && stores.size) {
      for (const s of stores.values()) s.release();
      drawnKey = '';
    }
    // warm the next piece's first frames so its title card has art behind it
    if (near && !atEnd) stores.get(pi + 1)?.pump(0, 4, false);

    if (hot) {
      const hn = (stores.get(hot.piece)?.n ?? pieces[hot.piece].frameCount) - 1;
      hot.h.update(atEnd ? hn : Math.min(frame, hn)); // at the end card everything has been passed
    }

    // rail fill = progress through this piece
    const prog = seg.phase === 'title' ? 0 : seg.phase === 'scrub' ? t : 1;
    railFill.style.transform = `scaleY(${prog.toFixed(4)})`;

    // VCR OSD
    const v = seg.vStart + t * seg.vLen;
    displayV = transition ? displayV + (v - displayV) * 0.12 : v;
    const tc = timecode(displayV);
    if (tc !== lastTc) {
      lastTc = tc;
      osdTc.textContent = tc;
    }
    const mode = transition ? '' : vel > 0.8 ? '▶ PLAY' : vel < -0.8 ? '◀ REV' : now - lastMoveAt > 350 ? '❚❚ PAUSE' : lastMode || '▶ PLAY';
    if (mode && mode !== lastMode) {
      lastMode = mode;
      osdMode.textContent = mode;
      osd.classList.toggle('is-paused', mode.startsWith('❚'));
    }

    if (debugOn && now - hudAt > 200) {
      hudAt = now;
      const s = cs;
      hud.textContent =
        `piece ${pi + 1}/${N} ${pieces[pi].id}\n` +
        `phase ${seg.phase}  t ${t.toFixed(3)}\n` +
        `frame ${frame}${s ? ` (${s.manifest.frames[frame] ?? '?'})` : ''}  scroll ${((smoothY / tl.range) * 100).toFixed(1)}%\n` +
        `${variant} ${s ? `${s.dims.width}x${s.dims.height}` : '-'}  fit ${letterbox ? 'contain+blur' : 'cover'}\n` +
        `fetched ${s?.blobCount ?? 0}/${s?.n ?? 0}  decoded ${s?.bitmaps.size ?? 0}\n` +
        `stores ${[...stores.keys()].map((i) => i + 1).join(',')}`;
    }
  }

  // Scroll position that lands just inside a piece's title card. Fractional px positions get rounded down by
  // scrollTo, which would land one px short, inside the previous piece's dip, so step past the boundary.
  const startY = (i: number) => Math.ceil(i >= N ? tl.endStart : tl.pieceStart[i]) + 1;

  // ------------------------------------------------------------------ travel (VCR fast-forward / rewind)
  async function keySources(i: number, from: number, to: number): Promise<KeySource[]> {
    const s = await stripFor(i);
    if (!s) return [];
    const cw = s.img.width / s.count;
    const out: KeySource[] = [];
    const step = from <= to ? 1 : -1;
    for (let k = from; step > 0 ? k <= to : k >= to; k += step) {
      out.push({ img: s.img, sx: k * cw, sy: 0, sw: cw, sh: s.img.height });
    }
    return out;
  }

  async function travel(to: number) {
    if (transition) return;
    closeIndex();
    const targetY = startY(to);
    const fromY = smoothY;
    if (Math.abs(targetY - fromY) < 4) return;
    transition = true;
    document.documentElement.style.overflow = 'hidden';
    hot?.h.closeAll();

    const dir: 1 | -1 = targetY > fromY ? 1 : -1;
    const { seg } = locate(tl, fromY);
    const fp = Math.min(seg.piece, N - 1);
    const sc = tl.scrub[fp];
    const frac = seg.piece >= N ? 1 : Math.min(1, Math.max(0, (fromY - sc.start) / sc.len));

    // Path along the tape from here to the target: the rest of this piece, then every piece in between.
    let keys: KeySource[] = [];
    if (dir > 0) {
      keys = keys.concat(await keySources(fp, Math.min(7, Math.ceil(frac * 7)), 7));
      for (let p = fp + 1; p < Math.min(to, N); p++) keys = keys.concat(await keySources(p, 0, 7));
    } else {
      keys = keys.concat(await keySources(fp, Math.floor(frac * 7), 0));
      for (let p = fp - 1; p >= Math.max(to, 0); p--) keys = keys.concat(await keySources(p, 7, 0));
    }

    // Start loading the destination and jump to it behind the overlay.
    if (to < N) wantStore(to);
    window.scrollTo(0, targetY);
    smoothY = targetY;
    lastY = targetY;
    displayV = locate(tl, fromY).seg.vStart;

    const ready = new Promise<void>((resolve) => {
      if (to >= N) return resolve();
      const t0 = performance.now();
      const poll = () => {
        const s = stores.get(to);
        if ((s && s.has(0)) || failed.has(to) || performance.now() - t0 > 8000) resolve();
        else setTimeout(poll, 50);
      };
      poll();
    });

    await vcr.play({
      frames: keys,
      dir,
      msPerFrame: Math.min(110, Math.max(45, 2400 / Math.max(keys.length, 1))),
      ready,
      reduceMotion: reduce.matches,
      letterbox,
    });

    titleEnteredAt = performance.now(); // the title card fades up on landing
    transition = false;
    document.documentElement.style.overflow = '';
    syncHash(to >= N ? '#end' : `#${pieces[to].id}`);
  }

  // ------------------------------------------------------------------ index ("tape label" list)
  function openIndex() {
    tape.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    indexBtn.setAttribute('aria-expanded', 'true');
    (tape.querySelector('[aria-current="true"]') as HTMLElement | null)?.focus();
  }
  function closeIndex() {
    if (tape.hidden) return;
    tape.hidden = true;
    if (!transition) document.documentElement.style.overflow = '';
    indexBtn.setAttribute('aria-expanded', 'false');
  }
  indexBtn.addEventListener('click', () => (tape.hidden ? openIndex() : closeIndex()));
  $('tapeClose').addEventListener('click', closeIndex);
  tape.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (item) travel(Number(item.dataset.i));
    else if (e.target === tape) closeIndex();
  });
  $('endTop').addEventListener('click', () => travel(0));

  // ------------------------------------------------------------------ navigation + sizing
  function idxFromHash(): number | null {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return null;
    if (h === 'end') return N;
    const i = pieces.findIndex((p) => p.id === h);
    return i >= 0 ? i : null;
  }

  function jumpInstant(i: number) {
    const y = startY(i);
    window.scrollTo(0, y);
    smoothY = lastY = y;
  }
  window.addEventListener('hashchange', () => {
    const i = idxFromHash();
    if (i !== null && !transition) {
      hashSynced = location.hash;
      jumpInstant(i);
    }
  });

  function onResize() {
    const { seg, t } = locate(tl, smoothY);
    tl = buildTimeline(pieces.map((p) => p.frameCount), window.innerHeight);
    scroller.style.height = `${tl.total}px`;
    const old = tl.segs.find((s) => s.piece === seg.piece && s.phase === seg.phase)!;
    const y = old.start + t * old.len;
    window.scrollTo(0, y);
    smoothY = lastY = y;
    resizeCanvases();
    layout(curPiece);
  }
  window.addEventListener('resize', onResize);

  mobileMQ.addEventListener('change', () => {
    // crossing the phone breakpoint swaps frame sizes: reload the stores at the new size
    variant = mobileMQ.matches ? 'mobile' : 'desktop';
    for (const i of [...stores.keys()]) dropStore(i);
    manifests.clear();
    drawnKey = '';
    dirty = true;
  });

  // ------------------------------------------------------------------ debug (G): HUD + grain tuner
  const grain = initGrain($('grain') as HTMLCanvasElement, GRAIN, reduce);
  {
    const panel = $('gdebug');
    const inOpacity = $('gOpacity') as HTMLInputElement;
    const inSize = $('gSize') as HTMLInputElement;
    const inFps = $('gFps') as HTMLInputElement;
    const inBlend = $('gBlend') as HTMLSelectElement;
    const values = $('gValues');
    const snippet = () => `const GRAIN = { opacity: ${GRAIN.opacity}, size: ${GRAIN.size}, fps: ${GRAIN.fps}, blend: '${GRAIN.blend}' };`;
    const sync = () => {
      inOpacity.value = String(GRAIN.opacity);
      inSize.value = String(GRAIN.size);
      inFps.value = String(GRAIN.fps);
      inBlend.value = GRAIN.blend;
      $('gOpacityOut').textContent = GRAIN.opacity.toFixed(3);
      $('gSizeOut').textContent = GRAIN.size.toFixed(2);
      $('gFpsOut').textContent = String(GRAIN.fps);
      values.textContent = snippet();
    };
    const onInput = () => {
      GRAIN.opacity = Number(inOpacity.value);
      GRAIN.size = Number(inSize.value);
      GRAIN.fps = Number(inFps.value);
      GRAIN.blend = inBlend.value;
      grain.apply();
      sync();
      console.log(snippet());
    };
    [inOpacity, inSize, inFps].forEach((el) => el.addEventListener('input', onInput));
    inBlend.addEventListener('change', onInput);
    $('gCopy').addEventListener('click', () => navigator.clipboard?.writeText(snippet()).catch(() => {}));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeIndex();
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        debugOn = !debugOn;
        panel.hidden = !debugOn;
        hud.hidden = !debugOn;
      }
    });
    sync();
  }

  // ------------------------------------------------------------------ boot
  history.scrollRestoration = 'manual';
  scroller.style.height = `${tl.total}px`;
  resizeCanvases();
  const first = idxFromHash();
  jumpInstant(first ?? 0);
  hashSynced = first === null ? '' : location.hash;
  pieces.forEach((_, i) => stripFor(i)); // small; warm them for the VCR transition
  requestAnimationFrame(tick);
}
