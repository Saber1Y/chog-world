// Builds favicon.ico (16/32/48, PNG-in-ICO), apple-icon.png, the OG image and a README lockup.
// Regenerate with: node scripts/brand-icons.mjs  (sources: apps/web/src/brand/*.svg)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// sharp is a backend dependency; resolve it from there rather than adding it to the web app.
const sharp = createRequire(join(root, "apps/backend/package.json"))("sharp");
const web = join(root, "apps/web");
const icon = readFileSync(`${web}/src/brand/app-icon.svg`);
const mark = readFileSync(`${web}/src/brand/mark.svg`);
const png = (svg, s) => sharp(svg, { density: 512 }).resize(s, s).png().toBuffer();

// favicon.ico with embedded PNGs
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(icon, s)));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
writeFileSync(`${web}/src/app/favicon.ico`, Buffer.concat([header, ...dir, ...images]));

// Apple touch icon: full-bleed square (iOS masks its own corners)
const inner = await png(icon, 196);
await sharp({ create: { width: 180, height: 180, channels: 4, background: "#836ef9" } })
  .composite([{ input: await sharp(inner).extract({ left: 8, top: 8, width: 180, height: 180 }).png().toBuffer() }])
  .png().toFile(`${web}/src/app/apple-icon.png`);

// OG image 1200x630
const big = await png(icon, 400);
const ogText = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><radialGradient id="g" cx="15%" cy="0%" r="80%"><stop offset="0" stop-color="#836ef9" stop-opacity="0.45"/><stop offset="1" stop-color="#120c22" stop-opacity="0"/></radialGradient></defs>
  <rect width="1200" height="630" fill="#120c22"/><rect width="1200" height="630" fill="url(#g)"/>
  <text x="545" y="250" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="96" fill="#fbf6ff">CHOG</text>
  <text x="545" y="350" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="96" fill="#ffd23f">WORLD</text>
  <text x="547" y="420" font-family="Arial, sans-serif" font-weight="700" font-size="30" fill="#b7a9d6">Every Chog was born identical.</text>
  <text x="547" y="462" font-family="Arial, sans-serif" font-weight="700" font-size="30" fill="#b7a9d6">Awaken yours. Watch it become someone.</text>
  <rect x="547" y="508" width="232" height="52" rx="26" fill="#836ef9" stroke="#0b0716" stroke-width="4"/>
  <text x="663" y="543" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="24" fill="#fbf6ff">on Monad</text>
</svg>`);
await sharp(ogText).composite([{ input: big, left: 100, top: 115 }]).png().toFile(`${web}/src/app/opengraph-image.png`);

// README lockup (dark, transparent-free)
const lockMark = await png(icon, 190);
const lockText = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="240">
  <rect width="900" height="240" rx="28" fill="#120c22"/>
  <text x="250" y="140" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="72" fill="#fbf6ff">CHOG <tspan fill="#ffd23f">WORLD</tspan></text>
  <text x="252" y="186" font-family="Arial, sans-serif" font-weight="700" font-size="24" fill="#b7a9d6">Every Chog was born identical.</text>
</svg>`);
await sharp(lockText).composite([{ input: lockMark, left: 28, top: 25 }]).png().toFile(join(root, "docs/logo.png"));
console.log("icons built");
