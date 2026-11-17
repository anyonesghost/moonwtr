// Convert Blender PNG sequences to WebP for the lab scroll pages.
//
// Two modes:
//
//   node scripts/convert-frames.mjs [name]
//       Legacy single sequence (default "scroll-test").
//       raw/<name>/*.png -> public/lab/<name>/frames/{desktop,mobile}/<frame>.webp
//                           public/lab/<name>/frames/manifest.json
//                           public/lab/<name>/cards/<slug>.webp  (hotspot lore cards)
//
//   node scripts/convert-frames.mjs reel [piece-id ...] [--force] [--verbose]
//       Every piece in src/data/pieces.json (or just the ids you list).
//       <piece.source>/*.png -> public/<piece.frames>/frames/{desktop,mobile}/<frame>.webp
//                               public/<piece.frames>/frames/manifest.json
//                               public/<piece.frames>/keys.webp   (8 low-res keyframes in a strip,
//                                                                  for the VCR fast-forward transition)
//                               public/<piece.frames>/still.webp  (poster for the index)
//       and writes `frameCount` back into src/data/pieces.json (that field only).
//       Pieces whose output manifest already matches are skipped unless --force.
//
// Where the PNGs live: `source` in pieces.json can be
//   - an absolute path (e.g. a network drive: "/Volumes/Studio/Renders/The Nest/PNG"), or
//   - relative, which resolves against $REEL_RAW_ROOT if you set it, else against this repo.
// So the multi-GB PNGs can stay on the drive. They are only read, once each, and never copied;
// only the small WebP output is written locally (public/lab/reel/).
//   REEL_RAW_ROOT="/Volumes/Studio/Renders" node scripts/convert-frames.mjs reel
//
// Output names keep the Blender frame number exactly as in the source filename (digits only, padding kept).
// The frames/desktop and frames/mobile folders are cleared before a piece is (re)converted.
//
// Per-piece knobs (optional fields in pieces.json):
//   "step": 2          keep every 2nd frame (halves the payload; the scrub gets a little steppier)
//   "quality": {"desktop": 74, "mobile": 72}
//   "reuse": true      frames already exist at `frames` (not made by this script); leave them alone

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 1));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ---------- shared helpers ----------

/** Numbered PNGs in a folder, sorted by frame. The last run of digits in the name is the frame number. */
async function listFrames(dir) {
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => /\.png$/i.test(f))
    .map((file) => {
      const match = path.basename(file, path.extname(file)).match(/(\d+)(?!.*\d)/);
      return match ? { file, id: match[1], frame: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.frame - b.frame);
  return files;
}

/** Resolve a piece's `source`: absolute as-is, else against $REEL_RAW_ROOT, else the repo. */
function resolveSource(source) {
  if (path.isAbsolute(source)) return source;
  return path.resolve(process.env.REEL_RAW_ROOT || root, source);
}

/** Run an async worker over indices 0..n-1 with limited concurrency. */
async function pool(n, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < n) await worker(next++);
    }),
  );
}

// ---------- legacy mode ----------

async function legacy(name) {
  const QUALITY = 80;
  const VARIANTS = [
    { name: 'desktop', width: 1920 },
    { name: 'mobile', width: 1080 },
  ];
  const CARDS_SRC = 'src/pages/lab/hotspots';
  const CARD_WIDTH = 1920;
  const CARD_QUALITY = 90;

  const srcDir = path.join(root, 'raw', name);
  const outDir = path.join(root, 'public', 'lab', name, 'frames');
  const files = await listFrames(srcDir);
  if (files.length === 0) {
    console.error(`No numbered PNGs found in ${path.relative(root, srcDir)}/`);
    process.exit(1);
  }

  for (const v of VARIANTS) {
    await rm(path.join(outDir, v.name), { recursive: true, force: true });
    await mkdir(path.join(outDir, v.name), { recursive: true });
  }

  const srcMeta = await sharp(path.join(srcDir, files[0].file)).metadata();
  console.log(`${files.length} frames, source ${srcMeta.width}x${srcMeta.height}, quality ${QUALITY}\n`);
  for (const v of VARIANTS) {
    if (srcMeta.width < v.width) {
      console.warn(
        `! source is ${srcMeta.width}px wide, narrower than the ${v.width}px ${v.name} target, ` +
          `not upscaling, ${v.name} frames stay ${srcMeta.width}px.`,
      );
    }
  }

  const results = new Array(files.length);
  const sizes = {};
  await pool(files.length, async (i) => {
    const { file, id } = files[i];
    const row = { id, src: (await stat(path.join(srcDir, file))).size };
    for (const v of VARIANTS) {
      const info = await sharp(path.join(srcDir, file))
        .resize({ width: v.width, withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 5 })
        .toFile(path.join(outDir, v.name, `${id}.webp`));
      row[v.name] = info.size;
      sizes[v.name] ??= { width: info.width, height: info.height };
    }
    results[i] = row;
  });

  console.log(`\n${'frame'.padEnd(8)}${'png'.padStart(12)}${VARIANTS.map((v) => v.name.padStart(12)).join('')}`);
  const totals = { src: 0 };
  for (const row of results) {
    totals.src += row.src;
    let line = row.id.padEnd(8) + kb(row.src).padStart(12);
    for (const v of VARIANTS) {
      totals[v.name] = (totals[v.name] ?? 0) + row[v.name];
      line += kb(row[v.name]).padStart(12);
    }
    console.log(line);
  }
  console.log(`\n${'total'.padEnd(8)}${mb(totals.src).padStart(12)}${VARIANTS.map((v) => mb(totals[v.name]).padStart(12)).join('')}`);
  console.log(
    `${'avg'.padEnd(8)}${kb(totals.src / files.length).padStart(12)}` +
      VARIANTS.map((v) => kb(totals[v.name] / files.length).padStart(12)).join(''),
  );

  const manifest = {
    name,
    frames: files.map((f) => f.id),
    variants: Object.fromEntries(VARIANTS.map((v) => [v.name, sizes[v.name]])),
  };
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(root, outDir)}/ (+ manifest.json)`);

  // hotspot cards
  const cardsDir = path.join(root, CARDS_SRC);
  const cardFiles = (await readdir(cardsDir).catch(() => [])).filter((f) => /\.png$/i.test(f));
  if (cardFiles.length) {
    const cardsOut = path.join(root, 'public', 'lab', name, 'cards');
    await rm(cardsOut, { recursive: true, force: true });
    await mkdir(cardsOut, { recursive: true });
    console.log('\ncards');
    for (const file of cardFiles) {
      const slug = path
        .basename(file, path.extname(file))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const info = await sharp(path.join(cardsDir, file))
        .resize({ width: CARD_WIDTH, withoutEnlargement: true })
        .webp({ quality: CARD_QUALITY })
        .toFile(path.join(cardsOut, `${slug}.webp`));
      console.log(`${file.padEnd(24)} -> cards/${slug}.webp  ${info.width}x${info.height}  ${kb(info.size)}`);
    }
  }
}

// ---------- reel mode ----------

// Vertical renders are 1080x1920 and far heavier than the horizontal test frames (200-550 KB each at
// native size), so desktop/mobile are sized to what the screen actually shows, not to the source.
const REEL_VARIANTS = {
  vertical: {
    desktop: { resize: { height: 1440 }, quality: 74 }, // 810x1440
    mobile: { resize: { width: 540 }, quality: 72 }, // 540x960
  },
  horizontal: {
    desktop: { resize: { width: 1920 }, quality: 80 },
    mobile: { resize: { width: 1080 }, quality: 78 },
  },
};
const KEY_COUNT = 8; // low-res keyframes per piece, used by the VCR fast-forward
const KEY_CELL_WIDTH = 216; // px per keyframe cell in the strip
const KEY_QUALITY = 70;
const STILL_WIDTH = 400;
const STILL_AT = 0.35; // fraction through the piece for the index poster

async function reel(args) {
  const force = args.includes('--force');
  const verbose = args.includes('--verbose');
  const wanted = args.filter((a) => !a.startsWith('--'));

  const piecesPath = path.join(root, 'src', 'data', 'pieces.json');
  const pieces = JSON.parse(await readFile(piecesPath, 'utf8'));
  const unknown = wanted.filter((id) => !pieces.some((p) => p.id === id));
  if (unknown.length) {
    console.error(`Unknown piece id(s): ${unknown.join(', ')}\nKnown: ${pieces.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  const grand = { src: 0, desktop: 0, mobile: 0, frames: 0 };

  for (const piece of pieces) {
    if (wanted.length && !wanted.includes(piece.id)) continue;
    if (piece.reuse) {
      // Frames already live elsewhere in public/ (e.g. the scroll-test). Never re-encode over them.
      console.log(`[${piece.id}] reuses ${piece.frames}, skipping`);
      continue;
    }

    const srcDir = resolveSource(piece.source);
    const outRoot = path.join(root, 'public', piece.frames);
    const outDir = path.join(outRoot, 'frames');
    const all = await listFrames(srcDir);
    if (all.length === 0) {
      console.error(`\n[${piece.id}] no numbered PNGs in ${srcDir} (drive not mounted? wrong path?), skipping`);
      continue;
    }
    const step = Math.max(1, piece.step ?? 1);
    const files = all.filter((_, i) => i % step === 0 || i === all.length - 1);

    // Skip when the output is already complete for this exact frame list.
    if (!force) {
      try {
        const prev = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
        if (prev.frames.length === files.length && prev.frames[0] === files[0].id && prev.frames.at(-1) === files.at(-1).id) {
          console.log(`[${piece.id}] up to date (${files.length} frames), skipping (use --force to redo)`);
          piece.frameCount = files.length;
          continue;
        }
      } catch {
        /* no manifest yet */
      }
    }

    const set = REEL_VARIANTS[piece.orientation] ?? REEL_VARIANTS.vertical;
    const q = piece.quality ?? {};
    const variants = Object.entries(set).map(([name, v]) => ({ name, resize: v.resize, quality: q[name] ?? v.quality }));

    for (const v of variants) {
      await rm(path.join(outDir, v.name), { recursive: true, force: true });
      await mkdir(path.join(outDir, v.name), { recursive: true });
    }

    const meta = await sharp(path.join(srcDir, files[0].file)).metadata();
    console.log(
      `\n[${piece.id}] ${files.length} frames${step > 1 ? ` (every ${step}th of ${all.length})` : ''}, ` +
        `source ${meta.width}x${meta.height}, ${variants.map((v) => `${v.name} q${v.quality}`).join(', ')}`,
    );

    const rows = new Array(files.length);
    const dims = {};
    let done = 0;
    let lastPct = -1;
    await pool(files.length, async (i) => {
      const { file, id } = files[i];
      const buf = await readFile(path.join(srcDir, file)); // one network read per frame
      const row = { id, src: buf.length };
      for (const v of variants) {
        const info = await sharp(buf)
          .resize({ ...v.resize, withoutEnlargement: true })
          .webp({ quality: v.quality, effort: 5 })
          .toFile(path.join(outDir, v.name, `${id}.webp`));
        row[v.name] = info.size;
        dims[v.name] ??= { width: info.width, height: info.height };
      }
      rows[i] = row;
      done++;
      const pct = Math.floor((done / files.length) * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`  ${pct}%\r`);
      }
    });

    // ---- keyframe strip for the VCR transition ----
    const cellH = Math.round((KEY_CELL_WIDTH * meta.height) / meta.width);
    const keyIdx = Array.from({ length: KEY_COUNT }, (_, k) => Math.round((k * (files.length - 1)) / (KEY_COUNT - 1)));
    const cells = await Promise.all(
      keyIdx.map(async (fi, k) => ({
        input: await sharp(path.join(srcDir, files[fi].file))
          .resize(KEY_CELL_WIDTH, cellH, { fit: 'cover' })
          .removeAlpha()
          .png()
          .toBuffer(),
        left: k * KEY_CELL_WIDTH,
        top: 0,
      })),
    );
    await sharp({
      create: { width: KEY_CELL_WIDTH * KEY_COUNT, height: cellH, channels: 3, background: '#000' },
    })
      .composite(cells)
      .webp({ quality: KEY_QUALITY })
      .toFile(path.join(outRoot, 'keys.webp'));

    // ---- index poster ----
    const stillFile = files[Math.round(STILL_AT * (files.length - 1))].file;
    await sharp(path.join(srcDir, stillFile))
      .resize({ width: STILL_WIDTH })
      .removeAlpha()
      .webp({ quality: 80 })
      .toFile(path.join(outRoot, 'still.webp'));

    const manifest = {
      id: piece.id,
      frames: files.map((f) => f.id),
      variants: dims,
      keys: { count: KEY_COUNT, cellWidth: KEY_CELL_WIDTH, cellHeight: cellH },
    };
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest) + '\n');
    piece.frameCount = files.length;
    await writeFile(piecesPath, JSON.stringify(pieces, null, 2) + '\n'); // persist as we go

    const tot = { src: 0, desktop: 0, mobile: 0 };
    for (const r of rows) {
      tot.src += r.src;
      tot.desktop += r.desktop;
      tot.mobile += r.mobile;
      if (verbose) console.log(`  ${r.id}  png ${kb(r.src).padStart(10)}  desktop ${kb(r.desktop).padStart(9)}  mobile ${kb(r.mobile).padStart(9)}`);
    }
    console.log(
      `  desktop ${dims.desktop.width}x${dims.desktop.height}  ${mb(tot.desktop)}  (avg ${kb(tot.desktop / files.length)})\n` +
        `  mobile  ${dims.mobile.width}x${dims.mobile.height}  ${mb(tot.mobile)}  (avg ${kb(tot.mobile / files.length)})\n` +
        `  source png ${mb(tot.src)}`,
    );
    grand.src += tot.src;
    grand.desktop += tot.desktop;
    grand.mobile += tot.mobile;
    grand.frames += files.length;
  }

  await writeFile(piecesPath, JSON.stringify(pieces, null, 2) + '\n');
  if (grand.frames) {
    console.log(
      `\nTOTAL ${grand.frames} frames: desktop ${mb(grand.desktop)}, mobile ${mb(grand.mobile)}, ` +
        `both ${mb(grand.desktop + grand.mobile)} (source png ${mb(grand.src)})`,
    );
  }
}

// ---------- entry ----------

const [, , first = 'scroll-test', ...rest] = process.argv;
if (first === 'reel') await reel(rest);
else await legacy(first);
