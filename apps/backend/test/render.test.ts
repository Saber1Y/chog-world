import { chogAmount, renderCardSvg } from "../src/render/card.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { escapeXml, frameTier, headlineTitle, renderOverlay, type ArtState } from "../src/render/art.js";
import { coinShift, recolorCoins, Renderer } from "../src/render/render.js";

const fresh: ArtState = { tokenId: "302", nickname: null, hue: 280, element: 0, level: 1, scars: 0, weaponTier: 0, armorTier: 0, titles: 0, injured: false };

describe("overlay art", () => {
  it("is deterministic and grows with progression", () => {
    expect(renderOverlay(fresh)).toBe(renderOverlay(fresh));
    expect(frameTier(1, 0).name).toBe("plain");
    expect(frameTier(5, 0).name).toBe("bronze");
    expect(frameTier(10, 0).name).toBe("silver");
    expect(frameTier(20, 0).name).toBe("gold");
    expect(frameTier(35, 0).name).toBe("mythic");
    expect(headlineTitle(0)).toBeNull();
    expect(headlineTitle(0b100001)).toBe("Devoted");
    expect(headlineTitle(0b000101)).toBe("Unbroken");
  });

  it("recolours coin gold but never the face, hair, blush or lines", () => {
    const px = (r: number, g: number, b: number) => Buffer.from([r, g, b]);
    const gold = recolorCoins(px(240, 200, 20), coinShift(230));
    expect(gold.equals(px(240, 200, 20))).toBe(false);
    expect(gold[2]!).toBeGreaterThan(gold[1]!); // gold turned toward blue/violet
    for (const keep of [px(250, 235, 215), px(90, 50, 170), px(240, 110, 140), px(10, 10, 10), px(255, 255, 255)]) {
      expect(recolorCoins(keep, 180).equals(keep)).toBe(true);
    }
    expect(coinShift(50)).toBe(0);
    expect(coinShift(10)).toBe(320);
  });

  it("escapes owner-written names", () => {
    const svg = renderOverlay({ ...fresh, nickname: `<script>"&'` });
    expect(svg).not.toContain("<script>");
    expect(escapeXml(`<a&"'>`)).toBe("&lt;a&amp;&quot;&apos;&gt;");
  });

  it("renders a 1024 PNG over the base and caches it", async () => {
    // A synthetic base so the test needs no network.
    const dir = mkdtempSync(join(tmpdir(), "chog-art-"));
    const basePath = join(dir, "base.png");
    writeFileSync(basePath, await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#6a3fd1" } }).png().toBuffer());
    const r = new Renderer(basePath);
    const a = await r.png({ ...fresh, level: 22, scars: 3, weaponTier: 2, armorTier: 3, titles: 0b10, injured: true, nickname: "Grape" });
    const meta = await sharp(a).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1024, 1024, "png"]);
    expect(await r.png({ ...fresh, level: 22, scars: 3, weaponTier: 2, armorTier: 3, titles: 0b10, injured: true, nickname: "Grape" })).toBe(a);
    const small = await sharp(await r.png(fresh, 256)).metadata();
    expect(small.width).toBe(256);
  });

  it("renders a 1200x630 share card with the name escaped and the portrait inside", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chog-card-"));
    const basePath = join(dir, "base.png");
    writeFileSync(basePath, await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#6a3fd1" } }).png().toBuffer());
    const r = new Renderer(basePath);
    const state = { art: { ...fresh, nickname: "<Grape & Co>" }, rep: 5, wins: 1, losses: 2, quests: 3, earned: "12.5", site: "example.test" };
    const meta = await sharp(await r.card(state)).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1200, 630, "png"]);
    expect(renderCardSvg(state)).toContain("&lt;Grape &amp; Co&gt;");
  });

  it("formats CHOG for the card", () => {
    expect(chogAmount(0n)).toBe("0");
    expect(chogAmount(1234n * 10n ** 18n + 5n * 10n ** 17n)).toBe("1,234.5");
    expect(chogAmount(94n * 10n ** 18n + 81n * 10n ** 16n)).toBe("94.81");
    expect(chogAmount(3n * 10n ** 16n)).toBe("0.03");
  });
});
