import { dnaOf, hueOf, ITEMS, ELEMENTS, TITLE_LABELS } from "@chog-world/shared";
import type { ChogSnapshot } from "../world/reader.js";
import { frameTier, headlineTitle, type ArtState } from "./art.js";

/** What the picture shows, derived from the Chog's onchain state. */
export function artStateOf(s: ChogSnapshot, nickname: string | null): ArtState {
  const best = (kind: "WEAPON" | "ARMOR") =>
    ITEMS.filter((i) => i.kind === kind && (s.items[i.id] ?? 0) > 0).reduce((m, i) => Math.max(m, i.tier), 0);
  return {
    tokenId: s.tokenId.toString(),
    nickname,
    hue: hueOf(dnaOf(s.collection, s.tokenId)),
    element: s.stats.element,
    // Unawakened Chogs read level 0 onchain; they are drawn as the level-1 they start at.
    level: Math.max(1, s.character.level),
    scars: s.character.scars,
    weaponTier: best("WEAPON"),
    armorTier: best("ARMOR"),
    titles: s.character.titles,
    injured: s.character.injuredUntil > s.blockTime,
  };
}

/** ERC-721 style metadata for the evolved Chog (a companion view; the real NFT's metadata is unchanged). */
export function metadataOf(s: ChogSnapshot, art: ArtState, imageUrl: string) {
  const titles = Object.entries(TITLE_LABELS)
    .filter(([bit]) => (art.titles & (1 << Number(bit))) !== 0)
    .map(([, t]) => t.name);
  return {
    name: art.nickname ? `${art.nickname} (Chog #${art.tokenId})` : `Chog #${art.tokenId}`,
    description: "Every Chog has a look. This is the life it lived in CHOG World.",
    image: imageUrl,
    attributes: [
      { trait_type: "Element", value: ELEMENTS[art.element] ?? "Unknown" },
      { trait_type: "Level", value: art.level, display_type: "number" },
      { trait_type: "Frame", value: frameTier(art.level, art.hue).name },
      { trait_type: "Reputation", value: s.character.rep, display_type: "number" },
      { trait_type: "Wins", value: s.character.wins, display_type: "number" },
      { trait_type: "Losses", value: s.character.losses, display_type: "number" },
      { trait_type: "Scars", value: art.scars, display_type: "number" },
      { trait_type: "Weapon tier", value: art.weaponTier, display_type: "number" },
      { trait_type: "Armor tier", value: art.armorTier, display_type: "number" },
      { trait_type: "Signature hue", value: art.hue, display_type: "number" },
      ...(headlineTitle(art.titles) ? [{ trait_type: "Title", value: headlineTitle(art.titles)! }] : []),
      ...titles.map((t) => ({ trait_type: "Trophy", value: t })),
    ],
  };
}
