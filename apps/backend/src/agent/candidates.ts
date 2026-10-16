import { encodeAbiParameters, keccak256, type Hex } from "viem";
import {
  ActionKind,
  ARENA,
  ARENA_TIER_FEES,
  CHOG,
  Goal,
  ITEMS,
  QUESTS,
  ZONES,
  winProbability,
  type QuestDef,
  type Stats,
} from "@chog-world/shared";
import type { ChogSnapshot, OpponentView } from "../world/reader.js";

/**
 * Builds the menu the agent chooses from. Every candidate here is legal right now and inside the
 * owner's onchain policy, so whatever the decider picks (LLM or heuristic) can only ever be one of
 * these. ChogOperator re-checks all of it onchain anyway; this just avoids wasting transactions.
 */

export type Candidate =
  | { id: string; kind: "quest"; questId: number; cost: bigint; label: string; score: number; facts: Facts }
  | { id: string; kind: "attack"; tokenId: bigint; tier: number; cost: bigint; label: string; score: number; facts: Facts }
  | { id: string; kind: "buy"; itemId: number; qty: number; cost: bigint; label: string; score: number; facts: Facts }
  | { id: string; kind: "use"; itemId: number; cost: bigint; label: string; score: number; facts: Facts }
  | { id: "rest"; kind: "rest"; cost: bigint; label: string; score: number; facts: Facts };

/** Plain numbers the decider can reason over. Never addresses or keys. */
export type Facts = Record<string, string | number | boolean>;

export const SIMULATIONS = 64;

interface Weights {
  money: number;
  rep: number;
  explore: number;
  strength: number;
}

export function goalWeights(goalMask: number): Weights {
  const has = (g: number) => (goalMask & g) !== 0;
  if (goalMask === 0) return { money: 1, rep: 1, explore: 1, strength: 1 };
  return {
    money: has(Goal.MONEY) ? 2 : 0.4,
    rep: has(Goal.REPUTATION) ? 2 : 0.4,
    explore: has(Goal.EXPLORE) ? 2 : 0.4,
    strength: has(Goal.STRONGEST) ? 2 : 0.4,
  };
}

function chog(n: bigint): number {
  return Number(n) / Number(CHOG);
}

function seedSalt(s: ChogSnapshot, tag: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [s.key, tag]));
}

/**
 * Why ChogOperator would refuse this kind of move for gas, or "" when the Chog can pay: the world's
 * fee is above what the owner agreed to, or the Chog's account holds less MON than the fee.
 */
export function gasBlock(s: ChogSnapshot, kind: number): string {
  const fee = s.gas.fees[kind as 0 | 1 | 2 | 3] ?? 0n;
  if (fee > s.policy.maxGasFee) return "gas fee above owner limit";
  if (fee > s.gas.balance) return "needs MON for gas";
  return "";
}

function permitted(s: ChogSnapshot, kind: number): boolean {
  return (s.policy.actionMask & (1 << kind)) !== 0;
}

/** Allowed by the owner's mask and affordable in gas: anything else would only waste a transaction. */
function allowed(s: ChogSnapshot, kind: number): boolean {
  return permitted(s, kind) && gasBlock(s, kind) === "";
}

const KINDS = [ActionKind.QUEST, ActionKind.ATTACK, ActionKind.BUY, ActionKind.USE];

/** Most the agent may spend on one action right now: wallet, policy cap and remaining daily budget. */
export function spendable(s: ChogSnapshot): bigint {
  let max = s.balance;
  if (s.policy.maxPerAction < max) max = s.policy.maxPerAction;
  if (s.policy.remaining < max) max = s.policy.remaining;
  return max;
}

/** How many recent moves count against a repeat, and how much each repeat costs in score. */
export const REPEAT_WINDOW = 4;
export const REPEAT_PENALTY = 0.35;

/**
 * Identity of a move for repeat detection: the same quest, the same opponent (any tier) or the same
 * item. Built from a candidate or from a stored action's kind and params, so both compare equal.
 */
export function moveKey(kind: string, params: Record<string, unknown>): string {
  switch (kind) {
    case "quest":
      return `quest-${String(params.questId)}`;
    case "attack":
      return `attack-${String(params.defender)}`;
    case "buy":
    case "use":
      return `${kind}-${String(params.itemId)}`;
    default:
      return kind;
  }
}

function candidateKey(c: Candidate): string {
  switch (c.kind) {
    case "quest":
      return moveKey("quest", { questId: c.questId });
    case "attack":
      return moveKey("attack", { defender: c.tokenId.toString() });
    case "buy":
    case "use":
      return moveKey(c.kind, { itemId: c.itemId });
    case "rest":
      return "rest";
  }
}

/**
 * A Chog that does the same thing over and over is dull to watch, so each recent repeat of a move
 * lowers its score. `recent` holds move keys of the latest executed moves, newest first.
 */
export function penalizeRepeats(cands: Candidate[], recent: string[]): Candidate[] {
  const window = recent.slice(0, REPEAT_WINDOW);
  return cands.map((c) => {
    if (c.kind === "rest") return c;
    const key = candidateKey(c);
    const repeats = window.filter((k) => k === key).length;
    return repeats ? { ...c, score: c.score - REPEAT_PENALTY * repeats, facts: { ...c.facts, doneRecently: repeats } } : c;
  });
}

/** How much a fight against the owner's grudge target outranks an equivalent fight. */
export const GRUDGE_BONUS = 1;

export function buildCandidates(s: ChogSnapshot, opponents: OpponentView[], recent: string[] = [], grudge: bigint | null = null): Candidate[] {
  return explainRest(s, penalizeRepeats(menu(s, opponents, grudge), recent));
}

/** Why a Chog with nothing but rest on its menu is resting, in words its owner can act on. */
const REST_REASONS: Record<string, string> = {
  "done for today": "Rest: I have made all my moves for today",
  "needs CHOG": "Rest: no CHOG left to pay quest or arena fees",
  "budget spent": "Rest: today's budget is spent",
};

function explainRest(s: ChogSnapshot, cands: Candidate[]): Candidate[] {
  const rest = cands[0];
  if (cands.length > 1 || !rest || rest.kind !== "rest" || rest.facts.reason) return cands;
  if (s.character.injuredUntil > s.blockTime) return cands;
  const cheapest = QUESTS.reduce((m, q) => (q.fee < m ? q.fee : m), QUESTS[0]!.fee);
  const reason =
    s.policy.actionsLeft <= 0 ? "done for today" : s.balance < cheapest ? "needs CHOG" : s.policy.remaining < cheapest ? "budget spent" : "";
  if (!reason) return cands;
  return [{ ...rest, label: REST_REASONS[reason]!, facts: { reason } }];
}

function menu(s: ChogSnapshot, opponents: OpponentView[], grudge: bigint | null): Candidate[] {
  const w = goalWeights(s.character.goalMask);
  const out: Candidate[] = [
    { id: "rest", kind: "rest", cost: 0n, label: "Rest and wait for a better moment", score: 0.05, facts: {} },
  ];
  if (s.policy.actionsLeft <= 0) return out;
  // Every permitted kind blocked by gas: say so, so the owner knows to top up (or raise the limit).
  const gasReasons = KINDS.filter((k) => permitted(s, k)).map((k) => gasBlock(s, k));
  if (gasReasons.length > 0 && gasReasons.every((r) => r !== "")) {
    const reason = gasReasons.includes("needs MON for gas") ? "needs MON for gas" : "gas fee above owner limit";
    out[0] = { ...out[0]!, label: reason === "needs MON for gas" ? "Rest: out of MON for gas" : "Rest: gas fee is above my owner's limit", facts: { reason } };
    return out;
  }
  const budget = spendable(s);
  const injured = s.character.injuredUntil > s.blockTime;
  const buffed = s.character.buffUntil > s.blockTime;
  const xpMult = buffed ? 1.5 : 1;

  // Heal first: an injured Chog cannot quest or fight.
  if (injured) {
    if (s.items[1]! > 0 && allowed(s, ActionKind.USE)) {
      out.push({
        id: "use-1",
        kind: "use",
        itemId: 1,
        cost: 0n,
        label: "Drink a Healing Potion",
        score: 3,
        facts: { injuredForMin: Math.ceil((s.character.injuredUntil - s.blockTime) / 60) },
      });
    } else {
      const potion = ITEMS.find((i) => i.id === 1)!;
      if (potion.price <= budget && allowed(s, ActionKind.BUY)) {
        out.push({
          id: "buy-1",
          kind: "buy",
          itemId: 1,
          qty: 1,
          cost: potion.price,
          label: "Buy a Healing Potion",
          score: 1.5,
          facts: { price: chog(potion.price), injuredForMin: Math.ceil((s.character.injuredUntil - s.blockTime) / 60) },
        });
      }
    }
    return out;
  }

  if (allowed(s, ActionKind.QUEST)) {
    for (const q of QUESTS) {
      const c = questCandidate(s, q, budget, w, xpMult);
      if (c) out.push(c);
    }
  }

  if (allowed(s, ActionKind.ATTACK)) {
    for (const o of opponents) {
      if (!o.attackable || o.key === s.key) continue;
      const p = winProbability(s.stats, o.stats, SIMULATIONS, seedSalt(s, `vs-${o.tokenId}`));
      for (let tier = 0; tier < ARENA_TIER_FEES.length; tier++) {
        const fee = ARENA_TIER_FEES[tier]!;
        if (fee > budget) continue;
        const burn = 0.1;
        const winNet = chog(fee) * (1 - burn) + chog(fee) * (ARENA.winBonusBps / 10_000) - chog(fee);
        const ev = p * winNet - (1 - p) * chog(fee);
        const repGain = p * 16 - (1 - p) * 8;
        const giant = o.level >= s.character.level + ARENA.giantGap;
        const xp = (p * ARENA.winXp + (1 - p) * ARENA.lossXp) * xpMult;
        const isGrudge = grudge !== null && o.tokenId === grudge;
        const score =
          w.money * ev / 10 +
          w.rep * repGain / 8 +
          w.strength * (xp / 40 + (giant ? 0.5 : 0)) -
          (1 - p) * 0.6 + // an injury costs tempo
          (isGrudge ? GRUDGE_BONUS : 0);
        out.push({
          id: `attack-${o.tokenId}-${tier}`,
          kind: "attack",
          tokenId: o.tokenId,
          tier,
          cost: fee,
          label: `Challenge ${isGrudge ? "my grudge, " : ""}Chog #${o.tokenId} (level ${o.level}) for ${chog(fee)} CHOG`,
          score,
          facts: {
            opponentLevel: o.level,
            opponentRep: o.rep,
            winChance: round(p),
            fee: chog(fee),
            expectedChog: round(ev),
            expectedRep: round(repGain),
            giantSlayerChance: giant,
            ...(isGrudge ? { grudge: true } : {}),
          },
        });
      }
    }
  }

  if (allowed(s, ActionKind.BUY)) {
    for (const slot of ["WEAPON", "ARMOR"] as const) {
      const owned = ITEMS.filter((i) => i.kind === slot && s.items[i.id]! > 0).reduce((m, i) => Math.max(m, i.tier), 0);
      const next = ITEMS.find((i) => i.kind === slot && i.tier === owned + 1);
      if (!next || next.price > budget) continue;
      // Spend on gear only while it leaves a working balance for fees.
      const leaves = s.balance - next.price;
      if (leaves < 20n * CHOG) continue;
      out.push({
        id: `buy-${next.id}`,
        kind: "buy",
        itemId: next.id,
        qty: 1,
        cost: next.price,
        label: `Buy ${next.name} (tier ${next.tier} ${slot.toLowerCase()})`,
        score: w.strength * 0.9 + w.money * -chog(next.price) / 200,
        facts: { price: chog(next.price), tier: next.tier, slot: slot.toLowerCase() },
      });
    }
    if (!buffed && s.items[2] === 0) {
      const elixir = ITEMS.find((i) => i.id === 2)!;
      if (elixir.price <= budget && s.balance - elixir.price >= 30n * CHOG) {
        out.push({
          id: "buy-2",
          kind: "buy",
          itemId: 2,
          qty: 1,
          cost: elixir.price,
          label: "Buy a Focus Elixir (+50% XP for a day)",
          score: w.strength * 0.4,
          facts: { price: chog(elixir.price) },
        });
      }
    }
  }

  if (allowed(s, ActionKind.USE) && !buffed && s.items[2]! > 0) {
    out.push({ id: "use-2", kind: "use", itemId: 2, cost: 0n, label: "Drink a Focus Elixir (+50% XP for a day)", score: 0.8 * w.strength + 0.4, facts: {} });
  }

  return out;
}

function questCandidate(
  s: ChogSnapshot,
  q: QuestDef,
  budget: bigint,
  w: Weights,
  xpMult: number,
): Candidate | undefined {
  if (s.character.level < q.minLevel || q.fee > budget) return undefined;
  const last = s.questLastStarted[q.id] ?? 0;
  if (last !== 0 && s.blockTime < last + q.cooldownSec) return undefined;

  const avgReward = (chog(q.rewardMin) + chog(q.rewardMax)) / 2;
  const fee = chog(q.fee);
  const zone = ZONES[q.zone]!;
  const p = q.kind === "HUNT" && q.monster ? winProbability(s.stats, q.monster as Stats, SIMULATIONS, seedSalt(s, `quest-${q.id}`)) : 1;
  const newZone = q.kind === "EXPLORE" && (s.character.zonesVisited & (1 << q.zone)) === 0;
  const xp = (p * q.xp + (1 - p) * (q.xp / 2) + (newZone ? q.xp / 2 : 0)) * xpMult;
  const ev = p * avgReward - fee;
  const rep = q.kind === "HUNT" ? p * 2 : newZone ? 3 : 0;

  const score =
    w.money * ev / 6 +
    w.rep * rep / 3 +
    w.explore * (q.kind === "EXPLORE" ? (newZone ? 1.6 : 0.3) : 0) +
    w.strength * xp / 40 -
    (1 - p) * 0.8;

  return {
    id: `quest-${q.id}`,
    kind: "quest",
    questId: q.id,
    cost: q.fee,
    label: q.kind === "EXPLORE" ? q.name : `${q.name} in ${zone.name}`,
    score,
    facts: {
      type: q.kind.toLowerCase(),
      fee,
      winChance: round(p),
      expectedChog: round(ev),
      expectedXp: Math.round(xp),
      newZone,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Highest-scoring first; ties broken by id so the order is stable. */
export function rank(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
