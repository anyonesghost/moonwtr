// Convert a Blender PNG sequence to WebP at desktop + mobile widths.
//
//   node scripts/convert-frames.mjs [name]        (name defaults to "scroll-test")
//
// Reads   raw/<name>/*.png
// Writes  public/lab/<name>/frames/desktop/<frame>.webp
//         public/lab/<name>/frames/mobile/<frame>.webp
//         public/lab/<name>/frames/manifest.json   (frame list the page reads)
//         public/lab/<name>/cards/<slug>.webp      (hotspot lore cards, see CARDS_SRC)
//
// The frames/desktop and frames/mobile folders are cleared first, so a re-run
// with a different frame set never leaves stale frames behind.
//
// Output names keep the Blender frame number exactly as it appears in the
// source filename (digits only, zero padding preserved).

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const QUALITY = 80;
const VARIANTS = [
  { name: 'desktop', width: 1920 },
  { name: 'mobile', width: 1080 },
];
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 1));

// Hotspot lore cards: flat PNGs named after the Blender empty they belong to
// ("Orb Lore.png" -> cards/orb-lore.webp). Skipped if the folder is missing.
const CARDS_SRC = 'src/pages/lab/hotspots';
const CARD_WIDTH = 1920;
const CARD_QUALITY = 90;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] ?? 'scroll-test';
const srcDir = path.join(root, 'raw', name);
const outDir = path.join(root, 'public', 'lab', name, 'frames');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const files = (await readdir(srcDir).catch(() => []))
  .filter((f) => /\.png$/i.test(f))
  .map((file) => {
    // Last run of digits in the name is the frame number ("0042.png", "shot_0042.png").
    const match = path.basename(file, path.extname(file)).match(/(\d+)(?!.*\d)/);
    return match ? { file, id: match[1], frame: Number(match[1]) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.frame - b.frame);

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
      `! source is ${srcMeta.width}px wide, narrower than the ${v.width}px ${v.name} target — ` +
        `not upscaling, ${v.name} frames stay ${srcMeta.width}px.`,
    );
  }
}

const results = new Array(files.length);
const sizes = {};

async function convert(i) {
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
}

let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < files.length) await convert(next++);
  }),
);

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
  frames: files.map((f) => f.id), // zero-padded ids, in playback order
  variants: Object.fromEntries(VARIANTS.map((v) => [v.name, sizes[v.name]])),
};
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nWrote ${path.relative(root, outDir)}/ (+ manifest.json)`);

// ---- hotspot cards ----
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
