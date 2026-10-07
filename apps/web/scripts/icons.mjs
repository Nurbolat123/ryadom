/* global console */
// Иконки PWA из brand/app-icon.svg: `pnpm --filter @ryadom/web icons`.
// Результат лежит в public/icons и хранится в git — пересобирать только при смене иконки.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "../../..");
const svg = readFileSync(resolve(root, "brand/app-icon.svg"));
const out = resolve(import.meta.dirname, "../public/icons");

// Знак занимает центральные ~62% — укладывается в безопасную зону maskable (круг 80%),
// поэтому maskable-иконка совпадает с обычной.
const sizes = {
  "icon-192.png": 192,
  "icon-512.png": 512,
  "maskable-512.png": 512,
  "apple-touch-icon.png": 180,
  "favicon-32.png": 32,
};
for (const [name, size] of Object.entries(sizes)) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${out}/${name}`);
  console.info(`icons: ${name} ${size}×${size}`);
}
