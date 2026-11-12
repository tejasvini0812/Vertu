// One-off: re-encode the bundled photographs as progressive mozjpeg (quality 80, at most 1600px wide).
// Run after replacing any image in src/assets/img:  node scripts/optimize-images.mjs
// Only writes a file when the result is at least 5% smaller, so running it twice changes nothing.
import sharp from 'sharp';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../src/assets/img/', import.meta.url).pathname;
let saved = 0;
for (const f of readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f))) {
  const src = readFileSync(dir + f);
  const out = await sharp(src).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80, progressive: true, mozjpeg: true }).toBuffer();
  if (out.length < src.length * 0.95) {
    writeFileSync(dir + f, out);
    saved += src.length - out.length;
    console.log(`${f}: ${(src.length / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB`);
  }
}
console.log(`saved ${(saved / 1024).toFixed(0)} KB`);
