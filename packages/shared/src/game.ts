import type { Stats } from "./engine.js";

/**
 * Game constants mirrored from the contracts and the seed data in
 * contracts/script/ChogWorldDeployer.sol. Keep both in sync.
 */

export const CHOG = 10n ** 18n;

export const Goal = {
  REPUTATION: 1 << 0,
  MONEY: 1 << 1,
  EXPLORE: 1 << 2,
  STRONGEST: 1 << 3,
} as const;
export type GoalKey = keyof typeof Goal;

export const GOAL_LABELS: Record<GoalKey, string> = {
  REPUTATION: "Increase my reputation",
  MONEY: "Make more money",
  EXPLORE: "Explore the world",
  STRONGEST: "Become the strongest Chog",
};

export const ActionKind = {
  QUEST: 0,
  ATTACK: 1,
  BUY: 2,
  USE: 3,
} as const;
export type ActionKindName = keyof typeof ActionKind;
export const ALL_ACTIONS = 0x0f;

export const Title = {
  FIRST_BLOOD: 0,
  GIANT_SLAYER: 1,
  UNBROKEN: 2,
  EXPLORER: 3,
  VETERAN: 4,
  DEVOTED: 5,
} as const;

export const TITLE_LABELS: Record<number, { name: string; how: string }> = {
  [Title.FIRST_BLOOD]: { name: "First Blood", how: "Won its first arena battle" },
  [Title.GIANT_SLAYER]: { name: "Giant Slayer", how: "Beat a Chog 5+ levels higher" },
  [Title.UNBROKEN]: { name: "Unbroken", how: "Held 5 arena defenses in a row" },
  [Title.EXPLORER]: { name: "Explorer", how: "Discovered every zone" },
  [Title.VETERAN]: { name: "Veteran", how: "Fought 50 arena battles" },
  [Title.DEVOTED]: { name: "Devoted", how: "Checked in 7 days in a row" },
};

export const TROPHY_BASE = 1000n;

export const ZONES = [
  { id: 0, name: "Purple Meadows", blurb: "Soft hills where young Chogs learn to scrap." },
  { id: 1, name: "Bandit Ridge", blurb: "Cliffside camps full of loot and bad decisions." },
  { id: 2, name: "Static Wastes", blurb: "Crackling flats where the air bites back." },
  { id: 3, name: "Wyrm's Hollow", blurb: "Something old sleeps here. Mostly." },
] as const;

export const QuestKind = { HUNT: 0, EXPLORE: 1, TRAIN: 2 } as const;
export type QuestKindName = keyof typeof QuestKind;

export interface QuestDef {
  id: number;
  name: string;
  kind: QuestKindName;
  zone: number;
  fee: bigint;
  rewardMin: bigint;
  rewardMax: bigint;
  xp: number;
  minLevel: number;
  cooldownSec: number;
  lootBps: number;
  lootId: number;
  monster?: Stats;
}

export const QUESTS: readonly QuestDef[] = [
  {
    id: 0,
    name: "Slime Pit",
    kind: "HUNT",
    zone: 0,
    fee: 5n * CHOG,
    rewardMin: 6n * CHOG,
    rewardMax: 12n * CHOG,
    xp: 20,
    minLevel: 1,
    cooldownSec: 600,
    lootBps: 3_000,
    lootId: 1,
    monster: { hp: 40, atk: 8, def: 2, spd: 4, crit: 0, element: 1 },
  },
  {
    id: 1,
    name: "Bandit Camp",
    kind: "HUNT",
    zone: 1,
    fee: 15n * CHOG,
    rewardMin: 18n * CHOG,
    rewardMax: 35n * CHOG,
    xp: 45,
    minLevel: 3,
    cooldownSec: 600,
    lootBps: 1_500,
    lootId: 11,
    monster: { hp: 130, atk: 17, def: 9, spd: 11, crit: 8, element: 2 },
  },
  {
    id: 2,
    name: "Elder Wyrm",
    kind: "HUNT",
    zone: 3,
    fee: 40n * CHOG,
    rewardMin: 60n * CHOG,
    rewardMax: 120n * CHOG,
    xp: 120,
    minLevel: 8,
    cooldownSec: 600,
    lootBps: 2_000,
    lootId: 13,
    monster: { hp: 260, atk: 30, def: 16, spd: 14, crit: 12, element: 0 },
  },
  ...ZONES.map(
    (z): QuestDef => ({
      id: 3 + z.id,
      name: `Explore ${z.name}`,
      kind: "EXPLORE",
      zone: z.id,
      fee: 2n * CHOG,
      rewardMin: 1n * CHOG,
      rewardMax: 4n * CHOG,
      xp: 15,
      minLevel: 1,
      cooldownSec: 7_200,
      lootBps: 1_000,
      lootId: 2,
    }),
  ),
  {
    id: 7,
    name: "Training Grounds",
    kind: "TRAIN",
    zone: 0,
    fee: 3n * CHOG,
    rewardMin: 0n,
    rewardMax: 0n,
    xp: 40,
    minLevel: 1,
    cooldownSec: 1_800,
    lootBps: 0,
    lootId: 0,
  },
];

export const ItemKind = { POTION: 1, ELIXIR: 2, WEAPON: 3, ARMOR: 4 } as const;

export interface ItemDef {
  id: number;
  name: string;
  kind: keyof typeof ItemKind;
  tier: number;
  price: bigint;
}

export const ITEMS: readonly ItemDef[] = [
  { id: 1, name: "Healing Potion", kind: "POTION", tier: 0, price: 15n * CHOG },
  { id: 2, name: "Focus Elixir", kind: "ELIXIR", tier: 0, price: 25n * CHOG },
  { id: 11, name: "Bent Spoon", kind: "WEAPON", tier: 1, price: 40n * CHOG },
  { id: 12, name: "Purple Shiv", kind: "WEAPON", tier: 2, price: 120n * CHOG },
  { id: 13, name: "Wyrmfang", kind: "WEAPON", tier: 3, price: 300n * CHOG },
  { id: 21, name: "Cardboard Vest", kind: "ARMOR", tier: 1, price: 40n * CHOG },
  { id: 22, name: "Scale Hoodie", kind: "ARMOR", tier: 2, price: 120n * CHOG },
  { id: 23, name: "Wyrmscale Coat", kind: "ARMOR", tier: 3, price: 300n * CHOG },
];

export const ARENA_TIER_FEES = [10n * CHOG, 50n * CHOG, 200n * CHOG] as const;

export const ARENA = {
  seedDelayBlocks: 2,
  pairCooldownSec: 3_600,
  defenderMaxPerHour: 3,
  loserInjurySec: 1_800,
  winBonusBps: 7_000,
  bountyBps: 5_000,
  winXp: 30,
  lossXp: 10,
  giantGap: 5,
} as const;

export const QUEST_SEED_DELAY_BLOCKS = 2;
/** Blocks after which BLOCKHASH is no longer available and a run is resolved as late. */
export const BLOCKHASH_WINDOW = 256;

export const POLICY_PRESETS = {
  CAUTIOUS: { label: "Cautious", dailyCap: 50n * CHOG, maxPerAction: 15n * CHOG, maxActionsPerDay: 3 },
  BALANCED: { label: "Balanced", dailyCap: 150n * CHOG, maxPerAction: 60n * CHOG, maxActionsPerDay: 6 },
  DEGEN: { label: "Degen", dailyCap: 500n * CHOG, maxPerAction: 200n * CHOG, maxActionsPerDay: 12 },
} as const;
export type PolicyPresetKey = keyof typeof POLICY_PRESETS;

/** One MON in wei. Gas fees are paid in MON, not CHOG. */
export const MON = 10n ** 18n;
/** Hard ceiling on ChogOperator's per-move gas fee (MAX_GAS_FEE in the contract). */
export const GAS_FEE_CEILING = MON / 2n;
/**
 * The most MON an owner agrees to pay the keeper per move when they enroll. A move costs the keeper
 * about 0.05 to 0.13 MON in gas (start plus settle), so this leaves room for gas prices to move.
 */
export const DEFAULT_MAX_GAS_FEE = MON / 5n;

/** ChogOperator.PolicyParams for a preset, with every action kind allowed and no expiry. */
export function policyParams(preset: PolicyPresetKey, maxGasFee: bigint = DEFAULT_MAX_GAS_FEE) {
  const p = POLICY_PRESETS[preset];
  return { expiry: 0n, actionMask: ALL_ACTIONS, maxActionsPerDay: p.maxActionsPerDay, maxPerAction: p.maxPerAction, dailyCap: p.dailyCap, maxGasFee };
}

export function questById(id: number): QuestDef | undefined {
  return QUESTS.find((q) => q.id === id);
}

export function itemById(id: number): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id);
}
