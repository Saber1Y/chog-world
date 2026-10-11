import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, http, publicActions, walletActions, keccak256, toHex, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { simulate, type Stats } from "../src/engine.js";
import { baseStats, dnaOf, hueOf } from "../src/dna.js";
import { engineHarnessAbi } from "../src/abis/index.js";
import { engineHarnessBytecode } from "./engineHarnessBytecode.js";
import { startAnvil } from "./anvil.js";

const CASES = 1_000;

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

function randomStats(next: () => number): Stats {
  // Cover both realistic ranges and extremes (zero attack, huge defence, max crit).
  const wide = next() % 4 === 0;
  return {
    hp: 1 + (next() % (wide ? 2_000 : 400)),
    atk: next() % (wide ? 500 : 60),
    def: next() % (wide ? 500 : 40),
    spd: next() % (wide ? 500 : 30),
    crit: next() % 101,
    element: next() % 4,
  };
}

describe("TypeScript engine matches the compiled Solidity", () => {
  let stop: () => void;
  let client: ReturnType<typeof makeClient>;
  let harness: Address;

  function makeClient(url: string) {
    return createTestClient({ chain: foundry, mode: "anvil", transport: http(url) })
      .extend(publicActions)
      .extend(walletActions);
  }

  beforeAll(async () => {
    const anvil = await startAnvil();
    stop = anvil.stop;
    client = makeClient(anvil.url);
    const [account] = await client.getAddresses();
    const hash = await client.deployContract({
      abi: engineHarnessAbi,
      bytecode: engineHarnessBytecode,
      account: account!,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    harness = receipt.contractAddress!;
  });

  afterAll(() => stop?.());

  it(`simulate() matches on ${CASES} random battles`, async () => {
    const next = rng(42);
    for (let i = 0; i < CASES; i++) {
      const a = randomStats(next);
      const b = randomStats(next);
      const seed = keccak256(toHex(`parity-${i}`)) as Hex;
      const sol = await client.readContract({ address: harness, abi: engineHarnessAbi, functionName: "simulate", args: [a, b, seed] });
      const ts = simulate(a, b, seed);
      expect({ i, aWins: ts.aWins, rounds: ts.rounds, hpA: ts.hpA, hpB: ts.hpB, logHash: ts.logHash }).toEqual({
        i,
        aWins: sol.aWins,
        rounds: sol.rounds,
        hpA: Number(sol.hpA),
        hpB: Number(sol.hpB),
        logHash: sol.logHash,
      });
    }
  });

  it("DNA, base stats and hue match for real Chog ids", async () => {
    const collection: Address = "0x9994604c3D3C43B82A79B41281E202613313Afba";
    for (let id = 1n; id <= 200n; id++) {
      const [d, base, hue] = await client.readContract({ address: harness, abi: engineHarnessAbi, functionName: "dna", args: [collection, id] });
      const tsDna = dnaOf(collection, id);
      expect(tsDna).toBe(d);
      expect(baseStats(tsDna)).toEqual(base);
      expect(hueOf(tsDna)).toBe(hue);
    }
  });
});
