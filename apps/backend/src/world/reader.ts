import { erc20Abi, erc721Abi, type Address, type Hex, type PublicClient } from "viem";
import {
  arenaAbi,
  chogItemsAbi,
  chogOperatorAbi,
  chogStateAbi,
  questBoardAbi,
  ARENA,
  ITEMS,
  QUESTS,
  type Deployment,
  type Stats,
} from "@chog-world/shared";

export interface PolicyView {
  owner: Address;
  active: boolean;
  paused: boolean;
  actionMask: number;
  expiry: number;
  maxPerAction: bigint;
  dailyCap: bigint;
  maxActionsPerDay: number;
  actionsToday: number;
  windowStart: number;
  remaining: bigint;
  actionsLeft: number;
}

export interface CharacterView {
  awakened: boolean;
  bornAt: number;
  xp: number;
  level: number;
  rep: number;
  wins: number;
  losses: number;
  quests: number;
  injuredUntil: number;
  buffUntil: number;
  titles: number;
  scars: number;
  goalMask: number;
  zonesVisited: number;
  streak: number;
  lastCheckIn: number;
}

export interface ChogSnapshot {
  collection: Address;
  tokenId: bigint;
  key: Hex;
  account: Address;
  accountDeployed: boolean;
  owner: Address;
  character: CharacterView;
  stats: Stats;
  policy: PolicyView;
  /** Empty when the agent may act; otherwise why not, straight from ChogOperator. */
  inactiveReason: string;
  balance: bigint;
  items: Record<number, number>;
  activeRunId: bigint;
  pendingBattleId: bigint;
  /** Unix seconds each quest was last started (0 = never). */
  questLastStarted: Record<number, number>;
  blockTime: number;
}

const SECONDS_PER_DAY = 86_400;

/** Reads everything a tick or an API view needs about one Chog in a single multicall. */
export class WorldReader {
  constructor(
    private readonly client: PublicClient,
    readonly d: Deployment,
  ) {}

  keyOf(tokenId: bigint): Promise<Hex> {
    return this.client.readContract({ address: this.d.state, abi: chogStateAbi, functionName: "keyOf", args: [this.d.collection, tokenId] });
  }

  accountOf(tokenId: bigint): Promise<Address> {
    return this.client.readContract({ address: this.d.state, abi: chogStateAbi, functionName: "accountOf", args: [this.d.collection, tokenId] });
  }

  async snapshot(tokenId: bigint): Promise<ChogSnapshot> {
    const c = this.d.collection;
    const [key, account, block] = await Promise.all([this.keyOf(tokenId), this.accountOf(tokenId), this.client.getBlock()]);
    const itemIds = ITEMS.map((i) => BigInt(i.id));

    const [owner, ch, stats, policy, reason, remaining, balance, itemBalances, run, pendingBattle] = await this.client.multicall({
      allowFailure: false,
      contracts: [
        { address: c, abi: erc721Abi, functionName: "ownerOf", args: [tokenId] },
        { address: this.d.state, abi: chogStateAbi, functionName: "character", args: [key] },
        { address: this.d.state, abi: chogStateAbi, functionName: "combatStats", args: [c, tokenId] },
        { address: this.d.operator, abi: chogOperatorAbi, functionName: "policyOf", args: [c, tokenId] },
        { address: this.d.operator, abi: chogOperatorAbi, functionName: "inactiveReason", args: [c, tokenId] },
        { address: this.d.operator, abi: chogOperatorAbi, functionName: "remainingDailyCap", args: [c, tokenId] },
        { address: this.d.chogToken, abi: erc20Abi, functionName: "balanceOf", args: [account] },
        { address: this.d.items, abi: chogItemsAbi, functionName: "balanceOfBatch", args: [itemIds.map(() => account), itemIds] },
        { address: this.d.quests, abi: questBoardAbi, functionName: "activeRun", args: [key] },
        { address: this.d.arena, abi: arenaAbi, functionName: "pendingBattle", args: [key] },
      ],
    });
    const lastStarted = await this.client.multicall({
      allowFailure: false,
      contracts: QUESTS.map((q) => ({
        address: this.d.quests,
        abi: questBoardAbi,
        functionName: "lastStartedAt" as const,
        args: [key, q.id] as const,
      })),
    });

    const code = await this.client.getCode({ address: account });
    const blockTime = Number(block.timestamp);
    const windowStart = Number(policy.windowStart);
    const windowExpired = blockTime >= windowStart + SECONDS_PER_DAY;
    const maxActionsPerDay = Number(policy.maxActionsPerDay);

    return {
      collection: c,
      tokenId,
      key,
      account,
      accountDeployed: !!code && code !== "0x",
      owner,
      character: toCharacter(ch as unknown as Record<string, unknown>),
      stats: toStats(stats),
      policy: {
        owner: policy.owner,
        active: policy.active,
        paused: policy.paused,
        actionMask: Number(policy.actionMask),
        expiry: Number(policy.expiry),
        maxPerAction: policy.maxPerAction,
        dailyCap: policy.dailyCap,
        maxActionsPerDay,
        actionsToday: windowExpired ? 0 : Number(policy.actionsToday),
        windowStart,
        remaining,
        actionsLeft: Math.max(0, maxActionsPerDay - (windowExpired ? 0 : Number(policy.actionsToday))),
      },
      inactiveReason: reason,
      balance,
      items: Object.fromEntries(ITEMS.map((it, i) => [it.id, Number(itemBalances[i] ?? 0n)])),
      activeRunId: run[0],
      pendingBattleId: pendingBattle,
      questLastStarted: Object.fromEntries(QUESTS.map((q, i) => [q.id, Number(lastStarted[i] ?? 0n)])),
      blockTime,
    };
  }

  /** Light view of a potential opponent: stats and whether the Arena would accept an attack now. */
  async opponents(attackerKey: Hex, attackerOwner: Address, tokenIds: bigint[]): Promise<OpponentView[]> {
    if (tokenIds.length === 0) return [];
    const c = this.d.collection;
    const keys = await Promise.all(tokenIds.map((id) => this.keyOf(id)));
    const perOpponent = 7;
    const calls = tokenIds.flatMap((id, i) => {
      const key = keys[i]!;
      return [
        { address: c, abi: erc721Abi, functionName: "ownerOf", args: [id] },
        { address: this.d.state, abi: chogStateAbi, functionName: "character", args: [key] },
        { address: this.d.state, abi: chogStateAbi, functionName: "combatStats", args: [c, id] },
        { address: this.d.arena, abi: arenaAbi, functionName: "pairKeyOf", args: [attackerKey, key] },
        { address: this.d.arena, abi: arenaAbi, functionName: "defenderWindowStart", args: [key] },
        { address: this.d.arena, abi: arenaAbi, functionName: "defenderWindowCount", args: [key] },
        { address: this.d.state, abi: chogStateAbi, functionName: "isInjured", args: [key] },
      ] as const;
    });
    const res = (await this.client.multicall({ allowFailure: true, contracts: calls as never })) as unknown as CallResult[];
    const pairKeys = tokenIds.map((_, i) => res[i * perOpponent + 3]?.result as Hex | undefined);
    const lastFights = (await this.client.multicall({
      allowFailure: true,
      contracts: pairKeys.map((pk) => ({ address: this.d.arena, abi: arenaAbi, functionName: "lastPairFight", args: [pk ?? "0x"] })) as never,
    })) as unknown as CallResult[];
    const now = Number((await this.client.getBlock()).timestamp);

    const out: OpponentView[] = [];
    tokenIds.forEach((id, i) => {
      const r = (j: number) => res[i * perOpponent + j];
      if (r(0)?.status !== "success" || r(1)?.status !== "success" || r(2)?.status !== "success") return;
      const owner = r(0)!.result as Address;
      const ch = toCharacter(r(1)!.result as Record<string, unknown>);
      if (!ch.awakened) return;
      const windowStart = Number((r(4)?.result as bigint | undefined) ?? 0n);
      const windowCount = Number((r(5)?.result as number | undefined) ?? 0);
      const injured = (r(6)?.result as boolean | undefined) ?? true;
      const lastFight = Number((lastFights[i]?.result as bigint | undefined) ?? 0n);
      const pairReady = lastFight === 0 || now >= lastFight + ARENA.pairCooldownSec;
      const defenderFree = now >= windowStart + 3_600 || windowCount < ARENA.defenderMaxPerHour;
      out.push({
        tokenId: id,
        key: keys[i]!,
        owner,
        level: ch.level,
        rep: ch.rep,
        stats: toStats(r(2)!.result as Stats),
        attackable: owner.toLowerCase() !== attackerOwner.toLowerCase() && !injured && pairReady && defenderFree,
        blockedBy:
          owner.toLowerCase() === attackerOwner.toLowerCase()
            ? "same owner"
            : injured
              ? "injured"
              : !pairReady
                ? "pair cooldown"
                : !defenderFree
                  ? "defender busy"
                  : undefined,
      });
    });
    return out;
  }
}

interface CallResult {
  status: "success" | "failure";
  result?: unknown;
}

export interface OpponentView {
  tokenId: bigint;
  key: Hex;
  owner: Address;
  level: number;
  rep: number;
  stats: Stats;
  attackable: boolean;
  blockedBy?: string;
}

function toStats(s: Stats | Record<string, unknown>): Stats {
  const r = s as Record<string, unknown>;
  return {
    hp: Number(r.hp),
    atk: Number(r.atk),
    def: Number(r.def),
    spd: Number(r.spd),
    crit: Number(r.crit),
    element: Number(r.element),
  };
}

function toCharacter(r: Record<string, unknown>): CharacterView {
  return {
    awakened: Boolean(r.awakened),
    bornAt: Number(r.bornAt),
    xp: Number(r.xp),
    level: Number(r.level),
    rep: Number(r.rep),
    wins: Number(r.wins),
    losses: Number(r.losses),
    quests: Number(r.quests),
    injuredUntil: Number(r.injuredUntil),
    buffUntil: Number(r.buffUntil),
    titles: Number(r.titles),
    scars: Number(r.scars),
    goalMask: Number(r.goalMask),
    zonesVisited: Number(r.zonesVisited),
    streak: Number(r.streak),
    lastCheckIn: Number(r.lastCheckIn),
  };
}
