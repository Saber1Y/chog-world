import { encodePacked, keccak256, parseEventLogs, type Hex } from "viem";
import { eq } from "drizzle-orm";
import { chogOperatorAbi, type Deployment } from "@chog-world/shared";
import type { Database } from "../database/db.js";
import { actions } from "../database/schema.js";
import { revertReason, type TxSender } from "../chain/chain.js";
import type { Candidate } from "./candidates.js";
import type { Decision } from "./decider.js";

export type ActionOutcome =
  | { status: "executed"; txHash: Hex }
  | { status: "blocked"; txHash: Hex; reason: string }
  | { status: "failed"; reason: string }
  | { status: "rested" };

/** Turns a decision into exactly one ChogOperator call, and records what happened. */
export class Executor {
  constructor(
    private readonly db: Database,
    private readonly keeper: TxSender,
    private readonly d: Deployment,
  ) {}

  static actionId(chogKey: Hex, nonce: string): Hex {
    return keccak256(encodePacked(["bytes32", "string"], [chogKey, nonce]));
  }

  async execute(chogKey: Hex, tokenId: bigint, decision: Decision, nonce: string): Promise<{ actionId: Hex; outcome: ActionOutcome }> {
    const c = decision.candidate;
    const actionId = Executor.actionId(chogKey, nonce);
    await this.db.insert(actions).values({
      actionId,
      chogKey,
      kind: c.kind,
      params: paramsOf(c),
      cost: c.cost.toString(),
      status: c.kind === "rest" ? "rested" : "decided",
      decidedBy: decision.decidedBy,
      thought: decision.thought,
      reason: decision.fallbackReason ?? null,
    });
    if (c.kind === "rest") return { actionId, outcome: { status: "rested" } };

    const call = this.callFor(c, tokenId, actionId);
    let outcome: ActionOutcome;
    try {
      await this.db.update(actions).set({ status: "submitted", updatedAt: new Date() }).where(eq(actions.actionId, actionId));
      const { hash, receipt } = await this.keeper.send(call);
      const logs = parseEventLogs({ abi: chogOperatorAbi, logs: receipt.logs });
      const blocked = logs.find((l) => l.eventName === "ActionBlocked");
      outcome = blocked
        ? { status: "blocked", txHash: hash, reason: (blocked.args as { reason: string }).reason }
        : { status: "executed", txHash: hash };
    } catch (err) {
      outcome = { status: "failed", reason: revertReason(err) };
    }

    await this.db
      .update(actions)
      .set({
        status: outcome.status,
        txHash: "txHash" in outcome ? outcome.txHash : null,
        reason: "reason" in outcome ? outcome.reason : (decision.fallbackReason ?? null),
        updatedAt: new Date(),
      })
      .where(eq(actions.actionId, actionId));
    return { actionId, outcome };
  }

  private callFor(c: Exclude<Candidate, { kind: "rest" }>, tokenId: bigint, actionId: Hex) {
    const base = { address: this.d.operator, abi: chogOperatorAbi } as const;
    const col = this.d.collection;
    switch (c.kind) {
      case "quest":
        return { ...base, functionName: "startQuest", args: [col, tokenId, c.questId, actionId] as const };
      case "attack":
        return { ...base, functionName: "attack", args: [col, tokenId, col, c.tokenId, c.tier, actionId] as const };
      case "buy":
        return { ...base, functionName: "buyItem", args: [col, tokenId, BigInt(c.itemId), BigInt(c.qty), actionId] as const };
      case "use":
        return { ...base, functionName: "useItem", args: [col, tokenId, BigInt(c.itemId), actionId] as const };
    }
  }
}

function paramsOf(c: Candidate): Record<string, string | number> {
  switch (c.kind) {
    case "quest":
      return { questId: c.questId };
    case "attack":
      return { defender: c.tokenId.toString(), tier: c.tier };
    case "buy":
      return { itemId: c.itemId, qty: c.qty };
    case "use":
      return { itemId: c.itemId };
    case "rest":
      return {};
  }
}
