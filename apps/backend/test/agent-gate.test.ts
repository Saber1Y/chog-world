import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent/agent.js";

describe("Agent spend gate", () => {
  it("starts no moves when the keeper cannot afford them, and says why", async () => {
    const logs: string[] = [];
    // Nothing past the gate may be touched: these would throw if used.
    const untouched = new Proxy({}, { get: () => { throw new Error("agent touched a dependency past a closed gate"); } }) as never;
    const agent = new Agent(
      untouched,
      untouched,
      untouched,
      untouched,
      untouched,
      untouched,
      { tickMinutes: 5, movesPerDay: 6, restMinutes: 60, batchSize: 20, scoutCount: 6 },
      (m) => logs.push(m),
      async () => ({ ok: false, reason: "keeper balance 0.01 MON is below 0.05 MON; top it up" }),
    );
    expect(await agent.sweep()).toEqual([]);
    expect(logs).toEqual(["not starting new moves: keeper balance 0.01 MON is below 0.05 MON; top it up"]);
  });

  it("spreads moves across the day and waits longer after resting", () => {
    const untouched = {} as never;
    const agent = new Agent(untouched, untouched, untouched, untouched, untouched, untouched, {
      tickMinutes: 15, movesPerDay: 6, restMinutes: 60, batchSize: 20, scoutCount: 6,
    });
    expect(agent.nextTickMinutes("executed", 24)).toBe(240); // the platform pace wins over a looser policy
    expect(agent.nextTickMinutes("executed", 3)).toBe(480); // a stricter policy slows it further
    expect(agent.nextTickMinutes("rested", 24)).toBe(60);
    expect(agent.nextTickMinutes("blocked", 24)).toBe(60);
    expect(agent.nextTickMinutes("failed", 24)).toBe(2);
  });
});
