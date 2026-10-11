import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import type { Stats } from "./engine.js";

/**
 * TypeScript mirror of contracts/src/libraries/ChogDNA.sol and ChogState.combatStats.
 * Every Chog shares the same metadata, so base stats come from a public hash of (collection, tokenId).
 */

export const DNA_SALT: Hex = keccak256(toBytes("CHOG_WORLD_DNA_V1"));

export const MAX_LEVEL = 50;
export const MAX_SCAR_BONUS = 5;

export function dnaOf(collection: Address, tokenId: bigint): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [DNA_SALT, collection, tokenId]),
  );
}

function byteAt(x: bigint, i: number): number {
  return Number((x >> BigInt(248 - i * 8)) & 0xffn);
}

export function baseStats(dna: Hex): Stats {
  const x = BigInt(dna);
  return {
    hp: 80 + (byteAt(x, 0) % 41),
    atk: 10 + (byteAt(x, 1) % 11),
    def: 4 + (byteAt(x, 2) % 9),
    spd: 5 + (byteAt(x, 3) % 11),
    crit: 3 + (byteAt(x, 4) % 10),
    element: byteAt(x, 5) % 4,
  };
}

/** Cosmetic hue, 0..359. */
export function hueOf(dna: Hex): number {
  const x = BigInt(dna);
  return ((byteAt(x, 6) << 8) | byteAt(x, 7)) % 360;
}

/** Cumulative XP needed to go from `level` to `level + 1`. */
export function xpThreshold(level: number): number {
  return 25 * level * (level + 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpThreshold(level)) level++;
  return level;
}

export interface Progression {
  level: number;
  scars: number;
  /** Highest gear tier held in the Chog's account, 0..3. */
  weaponTier: number;
  armorTier: number;
}

/** Mirror of ChogState.combatStats. */
export function combatStats(base: Stats, p: Progression): Stats {
  const lv = p.level === 0 ? 0 : p.level - 1;
  return {
    hp: base.hp + 5 * lv + 5 * p.armorTier,
    atk: base.atk + lv + 3 * p.weaponTier,
    def: base.def + Math.floor(lv / 2) + Math.min(p.scars, MAX_SCAR_BONUS) + 2 * p.armorTier,
    spd: base.spd + Math.floor(lv / 3),
    crit: base.crit,
    element: base.element,
  };
}
