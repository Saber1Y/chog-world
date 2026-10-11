import { describe, expect, it } from "vitest";
import { hasAdvantage, simulate, winProbability, MAX_ROUNDS } from "../src/engine.js";
import { combatStats, levelForXp, xpThreshold } from "../src/dna.js";

describe("engine", () => {
  it("replays: every hit's hp trail ends at the reported hp", () => {
    const r = simulate(
      { hp: 100, atk: 15, def: 8, spd: 10, crit: 7, element: 0 },
      { hp: 95, atk: 14, def: 9, spd: 12, crit: 5, element: 1 },
      "0x1234000000000000000000000000000000000000000000000000000000000000",
    );
    const last = r.hits.at(-1)!;
    expect(last.hpA).toBe(r.hpA);
    expect(last.hpB).toBe(r.hpB);
    expect(r.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(r.hits.length).toBeLessThanOrEqual(MAX_ROUNDS * 2);
  });

  it("element cycle", () => {
    expect(hasAdvantage(0, 1)).toBe(true);
    expect(hasAdvantage(3, 0)).toBe(true);
    expect(hasAdvantage(1, 0)).toBe(false);
  });

  it("win probability is extreme for mismatched fighters", () => {
    const giant = { hp: 500, atk: 80, def: 40, spd: 30, crit: 10, element: 0 };
    const slime = { hp: 30, atk: 3, def: 0, spd: 1, crit: 0, element: 0 };
    expect(winProbability(giant, slime, 32)).toBe(1);
    expect(winProbability(slime, giant, 32)).toBe(0);
  });
});

describe("progression", () => {
  it("level thresholds match ChogState", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(150)).toBe(3);
    expect(levelForXp(750)).toBe(6);
    expect(xpThreshold(10)).toBe(2750);
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(50);
  });

  it("combat stats mirror ChogState.combatStats", () => {
    const base = { hp: 100, atk: 15, def: 8, spd: 10, crit: 7, element: 2 };
    // Same scenario as ChogStateTest.test_CombatStatsGrowWithLevelScarsAndGear.
    expect(combatStats(base, { level: 3, scars: 1, weaponTier: 2, armorTier: 1 })).toEqual({
      hp: 115,
      atk: 23,
      def: 12,
      spd: 10,
      crit: 7,
      element: 2,
    });
    expect(combatStats(base, { level: 1, scars: 9, weaponTier: 0, armorTier: 0 }).def).toBe(13);
  });
});
