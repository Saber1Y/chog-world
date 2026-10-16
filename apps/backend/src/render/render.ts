import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import { CANVAS, renderOverlay, type ArtState } from "./art.js";
import { CARD_HEIGHT, CARD_PORTRAIT, CARD_WIDTH, renderCardSvg, type CardState } from "./card.js";

/** The collection's single shared image (every Chog's tokenURI points at the same metadata). */
export const CHOG_IMAGE_CID = "bafybeia3tgqoxsjhp7fqtd57bfbbeqxmatimnqssk4onngoxd4gdcp5nfu";
const GATEWAYS = ["https://gateway.pinata.cloud/ipfs", "https://w3s.link/ipfs", "https://dweb.link/ipfs"];

/**
 * Composites the overlay for a Chog's current state onto the shared base art. The base is fetched
 * from IPFS once and cached on disk; renders are cached in memory by state, since the same state
 * always draws the same picture.
 */
export class Renderer {
  private basePromise: Promise<Buffer> | undefined;
  private readonly cache = new Map<string, Buffer>();

  /**
   * @param tokenBase When set, each Chog is drawn over its own NFT picture (collections where every
   *        token looks different) instead of the shared, hue-shifted base art.
   */
  constructor(
    private readonly cachePath: string,
    private readonly maxEntries = 500,
    private readonly tokenBase?: (tokenId: string) => Promise<Buffer>,
  ) {}

  base(): Promise<Buffer> {
    this.basePromise ??= this.loadBase().catch((err: unknown) => {
      this.basePromise = undefined;
      throw err;
    });
    return this.basePromise;
  }

  private async loadBase(): Promise<Buffer> {
    if (existsSync(this.cachePath)) return readFileSync(this.cachePath);
    let lastError: unknown;
    for (const g of GATEWAYS) {
      try {
        const res = await fetch(`${g}/${CHOG_IMAGE_CID}`, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`${g} answered ${res.status}`);
        const raw = Buffer.from(await res.arrayBuffer());
        const resized = await sharp(raw).resize(CANVAS, CANVAS).png().toBuffer();
        mkdirSync(dirname(this.cachePath), { recursive: true });
        writeFileSync(this.cachePath, resized);
        return resized;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`could not fetch the Chog base image: ${(lastError as Error)?.message ?? lastError}`);
  }

  /** The base art with its coin pile recoloured to the Chog's DNA hue. */
  private async recolored(hue: number): Promise<Buffer> {
    const { data, info } = await sharp(await this.base()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = recolorCoins(data, coinShift(hue));
    return sharp(px, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  }

  async png(state: ArtState, size = CANVAS): Promise<Buffer> {
    const key = `${JSON.stringify(state)}@${size}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const base = this.tokenBase ? await this.tokenBase(state.tokenId) : await this.recolored(state.hue);
    // Scar marks are placed on the shared art's face; another picture puts the face elsewhere.
    const overlay = renderOverlay(this.tokenBase ? { ...state, scars: 0 } : state);
    const composed = await sharp(base)
      .composite([{ input: Buffer.from(overlay) }])
      .png()
      .toBuffer();
    const out = size === CANVAS ? composed : await sharp(composed).resize(size, size).png().toBuffer();
    this.remember(key, out);
    return out;
  }

  /** A 1200x630 share card: the evolved portrait plus name, level, title and record. */
  async card(state: CardState): Promise<Buffer> {
    const key = `card:${JSON.stringify(state)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = CARD_PORTRAIT;
    const portrait = await sharp(await this.png(state.art, p.size)).composite([{ input: roundedMask(p.size, 26), blend: "dest-in" }]).png().toBuffer();
    const out = await sharp(Buffer.from(renderCardSvg(state)))
      .resize(CARD_WIDTH, CARD_HEIGHT)
      .composite([{ input: portrait, left: p.x, top: p.y }])
      .png()
      .toBuffer();
    this.remember(key, out);
    return out;
  }

  private remember(key: string, value: Buffer): void {
    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, value);
  }
}

function roundedMask(size: number, radius: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
}

/** The coins in the shared art sit at about this hue. */
export const COIN_HUE = 50;

/** Rotation that makes the coin pile come out in the Chog's DNA hue. */
export function coinShift(dnaHue: number): number {
  return (((dnaHue - COIN_HUE) % 360) + 360) % 360;
}

/**
 * Rotates only the gold and amber pixels (the coins) by `shift` degrees. Cream skin and greys are
 * skipped by saturation; the purple hair, pink blush and black lines by hue. So the face is never
 * touched and there are no seams. Works on packed RGB, returns a new buffer.
 */
export function recolorCoins(rgb: Buffer, shift: number): Buffer {
  const px = Buffer.from(rgb);
  if (shift % 360 === 0) return px;
  for (let i = 0; i < px.length; i += 3) {
    const r = px[i]! / 255;
    const g = px[i + 1]! / 255;
    const b = px[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (max === 0 || d / max < 0.35) continue;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    if (h < 18 || h > 75) continue;
    const c = max * (d / max);
    const nh = (h + shift) % 360;
    const x = c * (1 - Math.abs(((nh / 60) % 2) - 1));
    const m = max - c;
    const [rr, gg, bb] =
      nh < 60 ? [c, x, 0] : nh < 120 ? [x, c, 0] : nh < 180 ? [0, c, x] : nh < 240 ? [0, x, c] : nh < 300 ? [x, 0, c] : [c, 0, x];
    px[i] = Math.round((rr + m) * 255);
    px[i + 1] = Math.round((gg + m) * 255);
    px[i + 2] = Math.round((bb + m) * 255);
  }
  return px;
}
