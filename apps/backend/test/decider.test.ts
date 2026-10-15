import { z } from "zod";
import { describe, expect, it } from "vitest";
import { LlmDecider, describe as describeSituation, heuristic, MAX_OPTIONS, servedGoal, type DecisionContext } from "../src/agent/decider.js";
import type { Candidate } from "../src/agent/candidates.js";
import { ModelError, type TextModel, type TextRequest } from "../src/llm/models.js";

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

/** Stands in for a language model: answers or throws whatever a scenario needs. */
function fakeModel(json: (req: TextRequest & { schema: z.ZodType }) => Promise<unknown>): TextModel {
  return {
    name: "fake",
    text: async () => "unused",
    json: async (req) => req.schema.parse(await json(req)),
  } as TextModel;
}

describe("LlmDecider", () => {
  it("uses the model's choice when it is valid", async () => {
    const r = await new LlmDecider(fakeModel(async () => ({ candidateId: "quest-7", thought: "Train first." }))).decide(ctx, cands);
    expect(r).toMatchObject({ decidedBy: "llm", thought: "Train first." });
    expect(r.candidate.id).toBe("quest-7");
  });

  it("falls back to the top candidate when the model names something off the menu", async () => {
    const r = await new LlmDecider(fakeModel(async () => ({ candidateId: "attack-999-2", thought: "x" }))).decide(ctx, cands);
    expect(r).toMatchObject({ decidedBy: "heuristic", fallbackReason: "model unavailable" });
    expect(r.candidate.id).toBe("quest-0");
  });

  it("falls back with the model's reason on refusals, rate limits and transport errors", async () => {
    const cases: [() => Promise<unknown>, string][] = [
      [async () => { throw new ModelError("gemini", "declined"); }, "declined"],
      [async () => { throw new ModelError("gemini > openrouter", "gemini: rate limited; openrouter: timed out"); }, "gemini: rate limited; openrouter: timed out"],
      [async () => { throw new Error("socket hang up"); }, "model unavailable"],
      [async () => ({ candidateId: "quest-7", thought: "   " }), "empty thought"],
    ];
    for (const [behaviour, reason] of cases) {
      const r = await new LlmDecider(fakeModel(behaviour)).decide(ctx, cands);
      expect(r).toMatchObject({ decidedBy: "heuristic", fallbackReason: reason });
    }
  });

  it("offers at most MAX_OPTIONS plus rest, and always rest", async () => {
    let seen: string | undefined;
    const many: Candidate[] = [
      { id: "rest", kind: "rest", cost: 0n, label: "Rest", score: -5, facts: {} },
      ...Array.from({ length: 20 }, (_, i): Candidate => ({ id: `quest-${i}`, kind: "quest", questId: i, cost: 1n, label: `Q${i}`, score: 20 - i, facts: {} })),
    ];
    await new LlmDecider(
      fakeModel(async (req) => {
        seen = req.user;
        return { candidateId: "rest", thought: "zz" };
      }),
    ).decide(ctx, many);
    const listed = seen!.split("\n").filter((l) => l.startsWith("- "));
    expect(listed).toHaveLength(MAX_OPTIONS + 1);
    expect(seen).toContain("- rest:");
  });

  it("never puts addresses or raw wei in the prompt", () => {
    const text = describeSituation(ctx, cands);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{8,}/);
    expect(text).toContain("<personality>Greedy but cautious. Hates slime.</personality>");
  });

  it("heuristic tells the owner how to get a resting Chog going again", () => {
    const rest = (reason: string): Candidate[] => [{ id: "rest", kind: "rest", cost: 0n, label: "Rest: x", score: 0.05, facts: { reason } }];
    expect(heuristic(ctx, rest("needs CHOG")).thought).toContain("Send me some CHOG");
    expect(heuristic(ctx, rest("needs MON for gas")).thought).toContain("MON");
    expect(heuristic(ctx, rest("done for today")).thought).toContain("tomorrow");
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
