import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { CHOG, type Deployment } from "@chog-world/shared";
import type { Hex } from "viem";
import type { Database } from "../database/db.js";
import { actions, chogs } from "../database/schema.js";
import type { WorldReader, ChogSnapshot } from "../world/reader.js";
import type { Journal } from "../journal/journal.js";
import { buildCandidates, moveKey, REPEAT_WINDOW } from "./candidates.js";
import { heuristic, type Decider, type DecisionContext } from "./decider.js";
import type { Executor } from "./executor.js";

export interface AgentConfig {
  /** Shortest gap between two looks at the same Chog. */
  tickMinutes: number;
  /**
   * Most moves a Chog makes per day, whatever its policy allows. Every move costs the keeper gas, so
   * moves are spread evenly across the day instead of spent as fast as the policy permits.
   */
  movesPerDay: number;
  /** How long a Chog waits after resting before it reconsiders. */
  restMinutes: number;
  /** Serve only the first this-many Chogs ever awakened (0 = everyone). Bounds cost during a pilot. */
  pilotMax?: number;
  /** Chogs handled per sweep, so one sweep never runs unbounded. */
  batchSize: number;
  /** Opponents scouted per tick. */
  scoutCount: number;
}

/** Says whether the keeper can afford new moves; when not, the reason to log. */
export type SpendGate = () => Promise<{ ok: true } | { ok: false; reason: string }>;

/** Note for a Chog outside the pilot; the web app shows it as the reason it is not acting. */
export const PILOT_FULL = "pilot is full";

export type TickResult =
  | { tokenId: bigint; status: "skipped"; note: string }
  | { tokenId: bigint; status: "rested" | "executed" | "blocked" | "failed"; note: string };

/**
 * The scheduled loop that makes every enrolled Chog act on its own. Each tick: read the chain,
 * stop if the owner's policy says so, build the legal menu, let the decider pick, execute through
 * ChogOperator, and write the story.
 */
export class Agent {
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly reader: WorldReader,
    private readonly decider: Decider,
    private readonly executor: Executor,
    private readonly journal: Journal,
    private readonly d: Deployment,
    private readonly cfg: AgentConfig,
    private readonly log: (msg: string) => void = () => undefined,
    private readonly gate: SpendGate = async () => ({ ok: true }),
  ) {}

  /** Runs every due Chog once. Re-entrant calls while a sweep is in progress are ignored. */
  async sweep(now = new Date()): Promise<TickResult[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const gate = await this.gate();
      if (!gate.ok) {
        this.log(`not starting new moves: ${gate.reason}`);
        return [];
      }
      const due = await this.db
        .select()
        .from(chogs)
        .where(and(eq(chogs.enrolled, true), lte(chogs.nextTickAt, now)))
        .orderBy(asc(chogs.nextTickAt))
        .limit(this.cfg.batchSize);
      const pilot = await this.pilotKeys();
      const results: TickResult[] = [];
      for (const row of due) {
        if (pilot && !pilot.has(row.key)) {
          await this.reschedule(row.key, PILOT_FULL, 24 * 60);
          results.push({ tokenId: BigInt(row.tokenId), status: "skipped", note: PILOT_FULL });
          continue;
        }
        try {
          results.push(await this.tick(BigInt(row.tokenId)));
        } catch (err) {
          const note = `tick error: ${(err as Error).message.split("\n")[0]}`;
          this.log(`#${row.tokenId} ${note}`);
          await this.reschedule(row.key, note, 2);
          results.push({ tokenId: BigInt(row.tokenId), status: "failed", note });
        }
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  async tick(tokenId: bigint): Promise<TickResult> {
    const s = await this.reader.snapshot(tokenId);
    const [row] = await this.db.select().from(chogs).where(eq(chogs.key, s.key));

    if (s.inactiveReason) {
      // Policy gone for good (sold, revoked): stop scheduling until the indexer sees a new enrollment.
      const permanent = s.inactiveReason === "owner changed" || s.inactiveReason === "not enrolled";
      if (permanent) await this.db.update(chogs).set({ enrolled: false, lastTickNote: s.inactiveReason }).where(eq(chogs.key, s.key));
      else await this.reschedule(s.key, s.inactiveReason, this.cfg.tickMinutes);
      return { tokenId, status: "skipped", note: s.inactiveReason };
    }
    if (s.activeRunId !== 0n || s.pendingBattleId !== 0n) {
      await this.reschedule(s.key, "waiting for a result", 1);
      return { tokenId, status: "skipped", note: "waiting for a result" };
    }

    const opponents = await this.scout(s);
    const candidates = buildCandidates(s, opponents, await this.recentMoves(s.key));
    const recent = (await this.journal.list(s.key, { limit: 5 })).map((e) => e.title);
    const ctx: DecisionContext = {
      tokenId,
      nickname: row?.nickname ?? null,
      personality: row?.personality ?? null,
      goalMask: s.character.goalMask,
      level: s.character.level,
      rep: s.character.rep,
      balanceChog: Number(s.balance) / Number(CHOG),
      remainingBudgetChog: Number(s.policy.remaining) / Number(CHOG),
      injured: s.character.injuredUntil > s.blockTime,
      recent,
    };
    // Nothing to choose between: rest without asking the decider (an LLM call would be wasted).
    const decision = candidates.length > 1 ? await this.decider.decide(ctx, candidates) : heuristic(ctx, candidates);
    const { actionId, outcome } = await this.executor.execute(s.key, tokenId, decision, randomUUID());

    // Consecutive identical rests are one story beat, not one per tick; a new reason to rest is news.
    const latest = (await this.journal.list(s.key, { limit: 1 }))[0];
    const repeatRest =
      outcome.status === "rested" &&
      latest?.kind === "thought" &&
      (latest.data as { kind?: string } | null)?.kind === "rest" &&
      latest.title === decision.thought;
    if (!repeatRest) await this.journal.write({
      chogKey: s.key,
      kind: "thought",
      title: decision.thought,
      body: decision.candidate.label,
      data: {
        actionId,
        kind: decision.candidate.kind,
        decidedBy: decision.decidedBy,
        outcome: outcome.status,
        ...("reason" in outcome ? { reason: outcome.reason } : {}),
        ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
      },
      txHash: "txHash" in outcome ? outcome.txHash : null,
      sourceKey: `thought:${actionId}`,
    });

    const note =
      outcome.status === "rested"
        ? "rested"
        : outcome.status === "executed"
          ? decision.candidate.label
          : `${outcome.status}: ${"reason" in outcome ? outcome.reason : ""}`;
    await this.reschedule(s.key, note, this.nextTickMinutes(outcome.status, s.policy.maxActionsPerDay));
    if (outcome.status !== "rested") this.log(`#${tokenId} ${note}`);
    return { tokenId, status: outcome.status, note };
  }

  /**
   * Keys of the Chogs in the pilot (the first `pilotMax` ever awakened), or null when there is no cap.
   */
  async pilotKeys(): Promise<Set<string> | null> {
    const max = this.cfg.pilotMax ?? 0;
    if (max <= 0) return null;
    // Only Chogs that have been handed to the agent count: a row made by naming a Chog takes no place.
    const rows = await this.db
      .select({ key: chogs.key })
      .from(chogs)
      .where(or(eq(chogs.enrolled, true), isNotNull(chogs.lastTickAt)))
      .orderBy(asc(chogs.createdAt), asc(chogs.key))
      .limit(max);
    return new Set(rows.map((r) => r.key));
  }

  /** Minutes until this Chog acts again: a failed send retries soon, a move waits its share of the day. */
  nextTickMinutes(status: TickResult["status"], policyMovesPerDay: number): number {
    if (status === "failed") return 2;
    if (status === "executed") {
      const perDay = Math.max(1, Math.min(this.cfg.movesPerDay, policyMovesPerDay));
      return Math.max(this.cfg.tickMinutes, Math.floor((24 * 60) / perDay));
    }
    return Math.max(this.cfg.tickMinutes, this.cfg.restMinutes);
  }

  /** Move keys of this Chog's latest moves that went onchain, newest first. */
  private async recentMoves(key: string): Promise<string[]> {
    const rows = await this.db
      .select({ kind: actions.kind, params: actions.params })
      .from(actions)
      .where(and(eq(actions.chogKey, key), inArray(actions.status, ["submitted", "executed"])))
      .orderBy(desc(actions.createdAt))
      .limit(REPEAT_WINDOW);
    return rows.map((r) => moveKey(r.kind, r.params as Record<string, unknown>));
  }

  /** Opponents near this Chog's level, from Chogs the world knows about. */
  private async scout(s: ChogSnapshot) {
    const rows = await this.db
      .select({ tokenId: chogs.tokenId, level: chogs.level })
      .from(chogs)
      .where(ne(chogs.key, s.key))
      .limit(200);
    const picks = rows
      .map((r) => ({ id: BigInt(r.tokenId), dist: Math.abs(r.level - s.character.level) + Math.random() * 2 }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, this.cfg.scoutCount)
      .map((r) => r.id);
    return this.reader.opponents(s.key, s.owner, picks);
  }

  private async reschedule(key: string, note: string, minutes: number): Promise<void> {
    await this.db
      .update(chogs)
      .set({ nextTickAt: new Date(Date.now() + minutes * 60_000), lastTickAt: new Date(), lastTickNote: note })
      .where(eq(chogs.key, key as Hex));
  }
}
