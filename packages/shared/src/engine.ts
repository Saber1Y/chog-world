import { encodeAbiParameters, encodePacked, keccak256, type Hex } from "viem";

/**
 * TypeScript mirror of contracts/src/libraries/BattleEngine.sol.
 * Every step must match the Solidity exactly (bigint arithmetic, same hashing), so a battle can be
 * replayed from its onchain seed and checked against the emitted `logHash`.
 */

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** Percent, 0..100. */
  crit: number;
  /** 0 Ember, 1 Moss, 2 Volt, 3 Tide. */
  element: number;
}

export interface Hit {
  round: number;
  attackerIsA: boolean;
  damage: number;
  crit: boolean;
  advantage: boolean;
  hpA: number;
  hpB: number;
}

export interface BattleResult {
  aWins: boolean;
  rounds: number;
  hpA: number;
  hpB: number;
  logHash: Hex;
  hits: Hit[];
}

export const MAX_ROUNDS = 12;

export const ELEMENTS = ["Ember", "Moss", "Volt", "Tide"] as const;
export type ElementName = (typeof ELEMENTS)[number];

/** Element cycle: Ember > Moss > Volt > Tide > Ember. */
export function hasAdvantage(attacker: number, defender: number): boolean {
  return (attacker + 1) % 4 === defender;
}

function stepRandom(seed: Hex, step: number): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [seed, BigInt(step)])));
}

export function simulate(a: Stats, b: Stats, seed: Hex): BattleResult {
  let hpA = BigInt(a.hp);
  let hpB = BigInt(b.hp);
  const aFirst = a.spd > b.spd || (a.spd === b.spd && (BigInt(seed) & 1n) === 0n);
  let log: Hex = seed;
  let step = 0;
  const hits: Hit[] = [];

  const finish = (aWins: boolean, rounds: number): BattleResult => ({
    aWins,
    rounds,
    hpA: Number(hpA),
    hpB: Number(hpB),
    logHash: log,
    hits,
  });

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (let turn = 0; turn < 2; turn++) {
      const attackerIsA = (turn === 0) === aFirst;
      const att = attackerIsA ? a : b;
      const dfn = attackerIsA ? b : a;

      const rnd = stepRandom(seed, step);
      step++;

      let dmg = (BigInt(att.atk) * (90n + (rnd % 21n))) / 100n;
      const armor = BigInt(dfn.def) / 2n;
      dmg = dmg > armor ? dmg - armor : 0n;
      if (dmg === 0n) dmg = 1n;
      const crit = (rnd >> 8n) % 100n < BigInt(att.crit);
      if (crit) dmg *= 2n;
      const advantage = hasAdvantage(att.element, dfn.element);
      if (advantage) dmg = (dmg * 115n) / 100n;

      log = keccak256(encodePacked(["bytes32", "bool", "uint256", "bool"], [log, attackerIsA, dmg, crit]));

      if (attackerIsA) hpB = hpB > dmg ? hpB - dmg : 0n;
      else hpA = hpA > dmg ? hpA - dmg : 0n;

      hits.push({ round, attackerIsA, damage: Number(dmg), crit, advantage, hpA: Number(hpA), hpB: Number(hpB) });

      if (hpA === 0n || hpB === 0n) return finish(hpB === 0n, round);
    }
  }

  // No knockout: larger fraction of hp left wins; ties go to B (the defender).
  return finish(hpA * BigInt(b.hp) > hpB * BigInt(a.hp), MAX_ROUNDS);
}

/** Fraction of `samples` simulated battles that A wins, using seeds derived from `salt`. */
export function winProbability(a: Stats, b: Stats, samples = 64, salt: Hex = "0x00"): number {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const seed = keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "uint256" }], [salt, BigInt(i)]));
    if (simulate(a, b, seed).aWins) wins++;
  }
  return wins / samples;
}
