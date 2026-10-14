import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeDecider, describe as describeSituation, heuristic, MAX_OPTIONS, servedGoal, type DecisionContext } from "../src/agent/decider.js";
import type { Candidate } from "../src/agent/candidates.js";

const ctx: DecisionContext = {
  tokenId: 7n,
  nickname: "Grape",
  personality: "Greedy but cautious. Hates slime.",
  goalMask: 2,
  level: 3,
  rep: 12,
  balanceChog: 120,
  remainingBudgetChog: 80,
  injured: false,
  recent: ["Cleared Slime Pit: +20 XP"],
};

const cands: Candidate[] = [
  { id: "rest", kind: "rest", cost: 0n, label: "Rest", score: 0.05, facts: {} },
  { id: "quest-0", kind: "quest", questId: 0, cost: 5n, label: "Slime Pit", score: 2, facts: { winChance: 1 } },
  { id: "quest-7", kind: "quest", questId: 7, cost: 3n, label: "Training", score: 1, facts: {} },
];

/** Stands in for the SDK client: returns or throws whatever a scenario needs. */
function fakeClient(behaviour: (...args: unknown[]) => Promise<unknown>): Anthropic {
  return { beta: { messages: { parse: behaviour } } } as unknown as Anthropic;
}

describe("ClaudeDecider", () => {
  it("uses the model's choice when it is valid", async () => {
    const d = new ClaudeDecider(fakeClient(async () => ({ stop_reason: "end_turn", parsed_output: { candidateId: "quest-7", thought: "Train first." } })), "m", 1000);
    const r = await d.decide(ctx, cands);
    expect(r).toMatchObject({ decidedBy: "llm", thought: "Train first." });
    expect(r.candidate.id).toBe("quest-7");
  });

  it("falls back to the top candidate when the model names something off the menu", async () => {
    const d = new ClaudeDecider(fakeClient(async () => ({ stop_reason: "end_turn", parsed_output: { candidateId: "attack-999-2", thought: "x" } })), "m", 1000);
    const r = await d.decide(ctx, cands);
    expect(r).toMatchObject({ decidedBy: "heuristic", fallbackReason: "unknown candidate" });
    expect(r.candidate.id).toBe("quest-0");
  });

  it("falls back on refusal, truncation, empty parse and transport errors", async () => {
    const cases: [() => Promise<unknown>, string][] = [
      [async () => ({ stop_reason: "refusal", parsed_output: null }), "model declined"],
      [async () => ({ stop_reason: "max_tokens", parsed_output: null }), "model ran out of tokens"],
      [async () => ({ stop_reason: "end_turn", parsed_output: null }), "unparseable output"],
      [async () => { throw new Anthropic.APIConnectionTimeoutError(); }, "model timed out"],
      [async () => { throw new Error("socket hang up"); }, "model unavailable"],
    ];
    for (const [behaviour, reason] of cases) {
      const r = await new ClaudeDecider(fakeClient(behaviour), "m", 1000).decide(ctx, cands);
      expect(r).toMatchObject({ decidedBy: "heuristic", fallbackReason: reason });
    }
  });

  it("offers at most MAX_OPTIONS plus rest, and always rest", async () => {
    let seen: { messages: { content: string }[]; output_config: unknown } | undefined;
    const many: Candidate[] = [
      { id: "rest", kind: "rest", cost: 0n, label: "Rest", score: -5, facts: {} },
      ...Array.from({ length: 20 }, (_, i): Candidate => ({ id: `quest-${i}`, kind: "quest", questId: i, cost: 1n, label: `Q${i}`, score: 20 - i, facts: {} })),
    ];
    const d = new ClaudeDecider(
      fakeClient(async (...args: unknown[]) => {
        seen = args[0] as typeof seen;
        return { stop_reason: "end_turn", parsed_output: { candidateId: "rest", thought: "zz" } };
      }),
      "m",
      1000,
    );
    await d.decide(ctx, many);
    const text = seen!.messages[0]!.content;
    const listed = text.split("\n").filter((l) => l.startsWith("- "));
    expect(listed).toHaveLength(MAX_OPTIONS + 1);
    expect(text).toContain("- rest:");
  });

  it("never puts addresses or raw wei in the prompt", () => {
    const text = describeSituation(ctx, cands);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{8,}/);
    expect(text).toContain("<personality>Greedy but cautious. Hates slime.</personality>");
  });

  it("heuristic picks the highest score", () => {
    expect(heuristic(ctx, cands).candidate.id).toBe("quest-0");
  });

  it("heuristic explains with the goal the action serves", () => {
    const explore: Candidate = { id: "quest-3", kind: "quest", questId: 3, cost: 2n, label: "Explore Purple Meadows", score: 9, facts: { type: "explore" } };
    // Money is listed first in the mask, but exploring serves the explore goal.
    const r = heuristic({ ...ctx, goalMask: 2 | 4 }, [explore]);
    expect(r.thought).toContain("explore the world");
    expect(servedGoal(explore, 2)).toBe("MONEY");
    expect(servedGoal(explore, 0)).toBeUndefined();
  });
});
