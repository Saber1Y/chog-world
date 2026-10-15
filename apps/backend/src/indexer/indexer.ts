import { eq, sql } from "drizzle-orm";
import { formatUnits, parseEventLogs, type Abi, type Address, type Hex, type Log, type PublicClient } from "viem";
import {
  arenaAbi,
  chogItemsAbi,
  chogOperatorAbi,
  chogStateAbi,
  itemById,
  questBoardAbi,
  questById,
  simulate,
  treasuryAbi,
  TITLE_LABELS,
  ZONES,
  type Deployment,
  type Stats,
} from "@chog-world/shared";
import type { Database } from "../database/db.js";
import { battles, chogs, cursors, events, questRuns } from "../database/schema.js";
import type { Journal, JournalInput, JournalRow } from "../journal/journal.js";

type JournalFn = (
  key: string,
  entry: Omit<JournalInput, "chogKey" | "sourceKey" | "txHash" | "blockNumber" | "createdAt">,
  suffix?: string,
) => Promise<void>;

const CONTRACTS = [
  ["state", chogStateAbi],
  ["operator", chogOperatorAbi],
  ["quests", questBoardAbi],
  ["arena", arenaAbi],
  ["items", chogItemsAbi],
  ["treasury", treasuryAbi],
] as const;

type ContractName = (typeof CONTRACTS)[number][0];

interface Decoded {
  contract: ContractName;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: number;
  logIndex: number;
  txHash: Hex;
  blockTime: Date;
}

const CURSOR = "events";

/**
 * Follows CHOG World's contracts and materializes what the app shows: Chog progression, quest runs,
 * battles (with replay data) and the journal. Idempotent end to end: events are unique on
 * (tx, logIndex) and journal entries on their source key, so a crash mid-range just replays it.
 */
export class Indexer {
  private readonly byAddress = new Map<string, { name: ContractName; abi: Abi }>();
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly d: Deployment,
    private readonly journal: Journal,
    private readonly range: number,
    private readonly log: (msg: string) => void = () => undefined,
  ) {
    for (const [name, abi] of CONTRACTS) this.byAddress.set(d[name].toLowerCase(), { name, abi: abi as Abi });
  }

  /** Indexes from the cursor up to the chain head, at most `maxRanges` getLogs calls per run. */
  async run(maxRanges = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const head = Number(await this.client.getBlockNumber());
      let from = await this.cursor();
      let ranges = 0;
      let count = 0;
      while (from <= head && ranges < maxRanges) {
        const to = Math.min(from + this.range - 1, head);
        const logs = await this.client.getLogs({
          address: [...this.byAddress.keys()] as Address[],
          fromBlock: BigInt(from),
          toBlock: BigInt(to),
        });
        count += await this.ingest(logs);
        await this.setCursor(to + 1);
        from = to + 1;
        ranges++;
      }
      return count;
    } finally {
      this.running = false;
    }
  }

  async cursor(): Promise<number> {
    const [row] = await this.db.select().from(cursors).where(eq(cursors.name, CURSOR));
    return row?.block ?? this.d.startBlock;
  }

  private async setCursor(block: number): Promise<void> {
    await this.db
      .insert(cursors)
      .values({ name: CURSOR, block })
      .onConflictDoUpdate({ target: cursors.name, set: { block } });
  }

  async ingest(logs: Log[]): Promise<number> {
    if (logs.length === 0) return 0;
    const blockTimes = new Map<bigint, Date>();
    for (const bn of new Set(logs.map((l) => l.blockNumber!))) {
      const b = await this.client.getBlock({ blockNumber: bn });
      blockTimes.set(bn, new Date(Number(b.timestamp) * 1000));
    }

    const decoded: Decoded[] = [];
    for (const l of logs) {
      const target = this.byAddress.get(l.address.toLowerCase());
      if (!target) continue;
      const [parsed] = parseEventLogs({ abi: target.abi, logs: [l], strict: false });
      if (!parsed || !parsed.eventName) continue;
      decoded.push({
        contract: target.name,
        eventName: parsed.eventName,
        args: (parsed.args ?? {}) as Record<string, unknown>,
        blockNumber: Number(l.blockNumber),
        logIndex: l.logIndex!,
        txHash: l.transactionHash!,
        blockTime: blockTimes.get(l.blockNumber!)!,
      });
    }
    decoded.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

    for (const e of decoded) {
      // Event row and its effects commit together; journal updates go out only after commit.
      const written: JournalRow[] = [];
      await this.db.transaction(async (tx) => {
        const exec = tx as unknown as Database;
        const [inserted] = await exec
          .insert(events)
          .values({
            blockNumber: e.blockNumber,
            logIndex: e.logIndex,
            txHash: e.txHash,
            contract: e.contract,
            name: e.eventName,
            chogKey: (e.args.key as string | undefined) ?? null,
            args: jsonSafe(e.args),
            blockTime: e.blockTime,
          })
          .onConflictDoNothing({ target: [events.txHash, events.logIndex] })
          .returning({ id: events.id });
        // Already processed in an earlier run: its effects are already committed.
        if (!inserted) return;
        await this.apply(e, exec, written);
      });
      for (const row of written) this.journal.emit(row);
    }
    return decoded.length;
  }

  // ---------------------------------------------------------------------
  // Materialization
  // ---------------------------------------------------------------------

  private async apply(e: Decoded, db: Database, written: JournalRow[]): Promise<void> {
    const a = e.args;
    const src = `${e.txHash}:${e.logIndex}`;
    const j: JournalFn = async (key, entry, suffix = "") => {
      const row = await this.journal.write(
        { ...entry, chogKey: key, sourceKey: `${src}${suffix}`, txHash: e.txHash, blockNumber: e.blockNumber, createdAt: e.blockTime },
        db,
      );
      if (row) written.push(row);
    };

    switch (`${e.contract}.${e.eventName}`) {
      case "state.Awakened": {
        const key = a.key as string;
        await db
          .insert(chogs)
          .values({
            key,
            collection: (a.collection as string).toLowerCase(),
            tokenId: (a.tokenId as bigint).toString(),
            account: (a.account as string).toLowerCase(),
            createdAt: e.blockTime,
          })
          .onConflictDoNothing({ target: chogs.key });
        await j(key, { kind: "life", title: "Awakened in CHOG World", body: "Born identical. Ready to become someone." });
        return;
      }
      case "state.GoalsSet":
        await db.update(chogs).set({ goalMask: Number(a.goalMask) }).where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "policy", title: "Owner set new goals", data: { goalMask: Number(a.goalMask) } });
        return;
      case "state.XpGained":
        await db.update(chogs).set({ xp: Number(a.totalXp) }).where(eq(chogs.key, a.key as string));
        return;
      case "state.LevelUp":
        await db.update(chogs).set({ level: Number(a.level) }).where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "level", title: `Reached level ${a.level}`, data: { level: Number(a.level) } });
        return;
      case "state.ReputationChanged":
        await db.update(chogs).set({ rep: Number(a.rep) }).where(eq(chogs.key, a.key as string));
        return;
      case "state.BattleRecorded":
        await db
          .update(chogs)
          .set({ wins: Number(a.wins), losses: Number(a.losses) })
          .where(eq(chogs.key, a.key as string));
        return;
      case "state.QuestRecorded":
        await db.update(chogs).set({ quests: Number(a.quests) }).where(eq(chogs.key, a.key as string));
        return;
      case "state.TitleAwarded": {
        const t = TITLE_LABELS[Number(a.title)];
        await db
          .update(chogs)
          .set({ titles: sql`${chogs.titles} | ${1 << Number(a.title)}` })
          .where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "title", title: `Earned the title ${t?.name ?? `#${a.title}`}`, body: t?.how ?? null });
        return;
      }
      case "state.ScarAdded":
        await db.update(chogs).set({ scars: Number(a.scars) }).where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "scar", title: `Took a scar (${a.scars} now)`, body: "Battle-hardened: scars toughen a Chog, up to five." });
        return;
      case "state.ZoneDiscovered": {
        const zone = ZONES[Number(a.zone)];
        await j(a.key as string, { kind: "zone", title: `Discovered ${zone?.name ?? `zone ${a.zone}`}`, body: zone?.blurb ?? null });
        return;
      }
      case "state.Injured":
        return;
      case "state.CheckedIn":
        await j(a.key as string, { kind: "life", title: `Owner checked in (streak ${a.streak})`, body: "+50% XP for the next 24 hours." });
        return;

      case "operator.Enrolled":
        await db
          .update(chogs)
          .set({ enrolled: true, owner: (a.owner as string).toLowerCase(), nextTickAt: e.blockTime })
          .where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "policy", title: "Handed the reins to its agent", body: policyText(a.params as PolicyArgs) });
        return;
      case "operator.PolicyUpdated":
        await j(a.key as string, { kind: "policy", title: "Owner updated the spending policy", body: policyText(a.params as PolicyArgs) });
        return;
      case "operator.PausedSet":
        await j(a.key as string, { kind: "policy", title: a.paused ? "Owner paused the agent" : "Owner resumed the agent" });
        return;
      case "operator.Revoked":
        await db.update(chogs).set({ enrolled: false }).where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "policy", title: "Owner revoked the agent" });
        return;
      case "operator.OwnerChanged":
        await db
          .update(chogs)
          .set({ enrolled: false, owner: (a.newOwner as string).toLowerCase() })
          .where(eq(chogs.key, a.key as string));
        await j(a.key as string, { kind: "policy", title: "Changed hands: the agent stood down", body: "Everything it owns moved with it. The new owner can awaken its agent again." });
        return;
      case "operator.ActionBlocked":
        await j(a.key as string, { kind: "policy", title: `Stopped by policy: ${a.reason}`, data: { cost: fmt(a.cost as bigint) } });
        return;

      case "quests.QuestStarted": {
        const q = questById(Number(a.questId));
        await db
          .insert(questRuns)
          .values({
            runId: (a.runId as bigint).toString(),
            chogKey: a.key as string,
            questId: Number(a.questId),
            startBlock: Number(a.startBlock),
            status: "active",
          })
          .onConflictDoNothing({ target: questRuns.runId });
        await j(a.key as string, { kind: "quest", title: `Set out for ${q?.name ?? `quest ${a.questId}`}`, data: { questId: Number(a.questId) } });
        return;
      }
      case "quests.QuestResolved": {
        const q = questById(Number(a.questId));
        const name = q?.name ?? `quest ${a.questId}`;
        const reward = a.reward as bigint;
        const lootId = Number(a.lootId);
        await db
          .update(questRuns)
          .set({
            status: "resolved",
            won: a.won as boolean,
            late: a.late as boolean,
            xp: Number(a.xp),
            reward: reward.toString(),
            lootId,
            seed: a.seed as string,
            resolveTx: e.txHash,
          })
          .where(eq(questRuns.runId, (a.runId as bigint).toString()));
        if (reward > 0n) await this.addEarned(db, a.key as string, reward);
        const loot = lootId ? itemById(lootId)?.name : undefined;
        const title = a.late
          ? `${name} fizzled (+${a.xp} XP)`
          : a.won
            ? `Cleared ${name}: +${a.xp} XP${reward > 0n ? `, +${fmt(reward)} CHOG` : ""}${loot ? `, found a ${loot}` : ""}`
            : `Beaten at ${name}: +${a.xp} XP, injured`;
        await j(a.key as string, { kind: "quest", title, data: { questId: Number(a.questId), won: a.won, late: a.late, seed: a.seed } });
        return;
      }

      case "arena.BattleStarted": {
        await db
          .insert(battles)
          .values({
            battleId: (a.battleId as bigint).toString(),
            attKey: a.attKey as string,
            defKey: a.defKey as string,
            tier: Number(a.tier),
            fee: (a.fee as bigint).toString(),
            startBlock: Number(a.startBlock),
            status: "pending",
            createdAt: e.blockTime,
          })
          .onConflictDoNothing({ target: battles.battleId });
        const [att, def] = await Promise.all([this.tokenOf(db, a.attKey as string), this.tokenOf(db, a.defKey as string)]);
        await j(a.attKey as string, { kind: "battle", title: `Challenged Chog #${def} for ${fmt(a.fee as bigint)} CHOG`, data: { battleId: String(a.battleId) } }, ":att");
        await j(a.defKey as string, { kind: "battle", title: `Was challenged by Chog #${att}`, data: { battleId: String(a.battleId) } }, ":def");
        return;
      }
      case "arena.BattleResolved":
        await this.resolveBattle(e, j, db);
        return;
      case "arena.BattleVoided":
        await db.update(battles).set({ status: "voided", resolveTx: e.txHash }).where(eq(battles.battleId, (a.battleId as bigint).toString()));
        return;
      case "arena.RivalryUpdated": {
        if (Number(a.fights) !== 3) return;
        const [ta, tb] = await Promise.all([this.tokenOf(db, a.a as string), this.tokenOf(db, a.b as string)]);
        await j(a.a as string, { kind: "battle", title: `A rivalry formed with Chog #${tb}` }, ":a");
        await j(a.b as string, { kind: "battle", title: `A rivalry formed with Chog #${ta}` }, ":b");
        return;
      }

      case "items.ItemBought": {
        const key = await this.keyOfAccount(db, a.buyer as string);
        if (!key) return;
        const item = itemById(Number(a.id));
        await j(key, { kind: "item", title: `Bought ${Number(a.qty) > 1 ? `${a.qty} x ` : "a "}${item?.name ?? `item ${a.id}`}`, data: { cost: fmt(a.cost as bigint) } });
        return;
      }
      case "items.ItemUsed": {
        const item = itemById(Number(a.id));
        await j(a.key as string, { kind: "item", title: `Used a ${item?.name ?? `item ${a.id}`}` });
        return;
      }
      case "treasury.Paid": {
        // Quest rewards are counted from QuestResolved; this covers arena bonuses.
        if ((a.game as string).toLowerCase() !== this.d.arena.toLowerCase()) return;
        const key = await this.keyOfAccount(db, a.to as string);
        if (key) await this.addEarned(db, key, a.paid as bigint);
        return;
      }
      default:
        return;
    }
  }

  private async resolveBattle(e: Decoded, j: JournalFn, db: Database) {
    const a = e.args;
    const battleId = (a.battleId as bigint).toString();
    const [b] = await db.select().from(battles).where(eq(battles.battleId, battleId));
    if (!b) return;
    const attackerWon = a.attackerWon as boolean;
    const seed = a.seed as Hex;

    // The stats each side fought with, read from the block before resolution, so the battle can be
    // replayed exactly. Checked against the onchain logHash before it is trusted.
    const [attStats, defStats] = await Promise.all([this.statsAt(db, b.attKey, e.blockNumber - 1), this.statsAt(db, b.defKey, e.blockNumber - 1)]);
    const replayable = !!attStats && !!defStats && simulate(attStats, defStats, seed).logHash === a.logHash;

    await db
      .update(battles)
      .set({
        status: "resolved",
        attackerWon,
        seed,
        logHash: a.logHash as string,
        rounds: Number(a.rounds),
        repDelta: Number(a.repDelta),
        payout: (a.payout as bigint).toString(),
        attStats: replayable ? attStats : null,
        defStats: replayable ? defStats : null,
        resolveBlock: e.blockNumber,
        resolveTx: e.txHash,
      })
      .where(eq(battles.battleId, battleId));

    if (!attackerWon) await this.addEarned(db, b.defKey, a.payout as bigint);
    const [att, def] = await Promise.all([this.tokenOf(db, b.attKey), this.tokenOf(db, b.defKey)]);
    const rep = Number(a.repDelta);
    const data = { battleId, attackerWon, replayable };
    if (attackerWon) {
      await j(b.attKey, { kind: "battle", title: `Beat Chog #${def} in the Arena (+${rep} rep)`, data }, ":att");
      await j(b.defKey, { kind: "battle", title: `Lost a defense to Chog #${att} (-${Math.floor(rep / 2)} rep), injured`, data }, ":def");
    } else {
      await j(b.attKey, { kind: "battle", title: `Lost to Chog #${def} (-${Math.floor(rep / 2)} rep), injured`, data }, ":att");
      await j(b.defKey, { kind: "battle", title: `Held off Chog #${att}: +${rep} rep, +${fmt(a.payout as bigint)} CHOG bounty`, data }, ":def");
    }
  }

  private async statsAt(db: Database, key: string, blockNumber: number): Promise<Stats | undefined> {
    const [row] = await db.select({ collection: chogs.collection, tokenId: chogs.tokenId }).from(chogs).where(eq(chogs.key, key));
    if (!row) return undefined;
    try {
      const s = await this.client.readContract({
        address: this.d.state,
        abi: chogStateAbi,
        functionName: "combatStats",
        args: [row.collection as Address, BigInt(row.tokenId)],
        blockNumber: BigInt(blockNumber),
      });
      return { hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, crit: s.crit, element: s.element };
    } catch (err) {
      this.log(`stats for ${key} at ${blockNumber} unavailable: ${(err as Error).message.split("\n")[0]}`);
      return undefined;
    }
  }

  private async tokenOf(db: Database, key: string): Promise<string> {
    const [row] = await db.select({ tokenId: chogs.tokenId }).from(chogs).where(eq(chogs.key, key));
    return row?.tokenId ?? "?";
  }

  private async keyOfAccount(db: Database, account: string): Promise<string | undefined> {
    const [row] = await db.select({ key: chogs.key }).from(chogs).where(eq(chogs.account, account.toLowerCase()));
    return row?.key;
  }

  private async addEarned(db: Database, key: string, amount: bigint): Promise<void> {
    await db
      .update(chogs)
      .set({ earned: sql`(${chogs.earned}::numeric + ${amount.toString()}::numeric)::text` })
      .where(eq(chogs.key, key));
  }
}

interface PolicyArgs {
  dailyCap: bigint;
  maxPerAction: bigint;
  maxActionsPerDay: number;
}

function policyText(p: PolicyArgs | undefined): string | null {
  if (!p) return null;
  return `Up to ${fmt(p.dailyCap)} CHOG a day, ${fmt(p.maxPerAction)} per action, ${p.maxActionsPerDay} actions a day.`;
}

function fmt(wei: bigint): string {
  const s = formatUnits(wei, 18);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, 2).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i!;
}

/** bigint is not JSON; store it as a decimal string. */
function jsonSafe(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Record<string, unknown>;
}
