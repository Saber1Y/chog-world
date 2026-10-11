import { eq } from "drizzle-orm";
import type { Address, PublicClient } from "viem";
import { arenaAbi, questBoardAbi, QUEST_SEED_DELAY_BLOCKS, type Deployment } from "@chog-world/shared";
import type { Database } from "../database/db.js";
import { battles, chogs, questRuns } from "../database/schema.js";
import { revertReason, type TxSender } from "../chain/chain.js";

/** Errors meaning someone else already settled it; not failures. */
const ALREADY_DONE = new Set(["NoActiveRun", "AlreadyResolved"]);

/**
 * Settles quests and battles as soon as their seed block exists. Resolution is permissionless and
 * the outcome does not depend on who resolves or when (inside the 256-block window), so the only
 * job here is to be prompt: a run left past the window fizzles (quests) or is refunded (battles).
 */
export class Resolver {
  private readonly inFlight = new Set<string>();
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly sender: TxSender,
    private readonly d: Deployment,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const head = Number(await this.client.getBlockNumber());
      let settled = 0;

      const runs = await this.db
        .select({ runId: questRuns.runId, chogKey: questRuns.chogKey, startBlock: questRuns.startBlock, tokenId: chogs.tokenId })
        .from(questRuns)
        .innerJoin(chogs, eq(chogs.key, questRuns.chogKey))
        .where(eq(questRuns.status, "active"));
      for (const r of runs) {
        if (head <= r.startBlock + QUEST_SEED_DELAY_BLOCKS) continue;
        if (await this.settle(`quest:${r.runId}`, () =>
          this.sender.send({
            address: this.d.quests,
            abi: questBoardAbi,
            functionName: "resolveQuest",
            args: [this.d.collection as Address, BigInt(r.tokenId)],
          }),
        )) settled++;
      }

      const pending = await this.db.select().from(battles).where(eq(battles.status, "pending"));
      for (const b of pending) {
        if (head <= b.startBlock + QUEST_SEED_DELAY_BLOCKS) continue;
        if (await this.settle(`battle:${b.battleId}`, () =>
          this.sender.send({ address: this.d.arena, abi: arenaAbi, functionName: "resolveBattle", args: [BigInt(b.battleId)] }),
        )) settled++;
      }
      return settled;
    } finally {
      this.running = false;
    }
  }

  /** The indexer marks the row resolved when it sees the event; this only sends the transaction. */
  private async settle(id: string, send: () => Promise<unknown>): Promise<boolean> {
    if (this.inFlight.has(id)) return false;
    this.inFlight.add(id);
    try {
      await send();
      return true;
    } catch (err) {
      const reason = revertReason(err);
      if (!ALREADY_DONE.has(reason)) this.log(`resolve ${id} failed: ${reason}`);
      return false;
    } finally {
      this.inFlight.delete(id);
    }
  }
}
