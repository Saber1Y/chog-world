import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
  publicActions,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { accountV3Abi, chogOperatorAbi, chogStateAbi, EXTERNAL, monadTestnet, POLICY_PRESETS, simulate, type Stats } from "@chog-world/shared";
import { loadEnv } from "../src/config/env.js";
import { buildContext, type AppContext } from "../src/app/context.js";
import { actions, battles, chogs, questRuns } from "../src/database/schema.js";
import { eq } from "drizzle-orm";

/**
 * M1 end to end, no mocks in the loop: a local anvil fork of Monad testnet (real ERC-6551 registry
 * and Tokenbound AccountV3), CHOG World deployed by the real Deploy script, owners onboarding the
 * way the web app will, and the backend's agent, resolver and indexer acting on it.
 * The decider is the heuristic one here (no model call); the Claude path is covered separately.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONTRACTS = join(ROOT, "contracts");
const TESTNET_RPC = "https://testnet-rpc.monad.xyz";

// Anvil's well-known development accounts (public test keys; local chain only).
const ADMIN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const KEEPER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const KEEPER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ALICE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const BOB = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const CAROL = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as const;

const devChogAbi = parseAbi([
  "function mint(address to) returns (uint256)",
  "function transferFrom(address from, address to, uint256 id)",
]);
const devTokenAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const proxyAbi = parseAbi(["function initialize(address implementation)"]);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const a = s.address();
      if (a && typeof a === "object") s.close(() => resolve(a.port));
      else reject(new Error("no port"));
    });
  });
}

describe("M1: autonomous loop end to end on a Monad testnet fork", () => {
  let anvil: ChildProcess;
  let rpc: string;
  let ctx: AppContext;
  let dataDir: string;
  let deploymentFile: string;
  let d: { collection: Address; chogToken: Address; operator: Address; state: Address };
  const test = () => createTestClient({ chain: { ...monadTestnet, rpcUrls: { default: { http: [rpc] } } }, mode: "anvil", transport: http(rpc) }).extend(publicActions);
  const walletOf = (account: Address) => createWalletClient({ chain: { ...monadTestnet, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc), account });

  async function write(account: Address, address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
    const hash = await walletOf(account).writeContract({ address, abi, functionName, args } as never);
    const receipt = await test().waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    return receipt;
  }

  async function onboard(owner: Address, tokenId: bigint, fundChog: bigint): Promise<Address> {
    const t = test();
    const account = await t.readContract({ address: d.state, abi: chogStateAbi, functionName: "accountOf", args: [d.collection, tokenId] });
    // What the web app's Awaken wizard does: create + initialize the account, grant, enroll, fund.
    await write(owner, EXTERNAL.erc6551Registry, parseAbi(["function createAccount(address,bytes32,uint256,address,uint256) returns (address)"]), "createAccount", [
      EXTERNAL.tokenboundAccountProxy,
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      BigInt(monadTestnet.id),
      d.collection,
      tokenId,
    ]);
    await write(owner, account, proxyAbi, "initialize", [EXTERNAL.tokenboundAccountV3]);
    await write(owner, account, accountV3Abi as Abi, "setPermissions", [[d.operator], [true]]);
    const p = POLICY_PRESETS.BALANCED;
    await write(owner, d.operator, chogOperatorAbi as Abi, "enroll", [
      d.collection,
      tokenId,
      { expiry: 0n, actionMask: 0x0f, maxActionsPerDay: p.maxActionsPerDay, maxPerAction: p.maxPerAction, dailyCap: p.dailyCap },
    ]);
    await write(ADMIN, d.chogToken, devTokenAbi, "mint", [account, fundChog]);
    return account;
  }

  beforeAll(async () => {
    const port = await freePort();
    rpc = `http://127.0.0.1:${port}`;
    anvil = spawn("anvil", ["--fork-url", TESTNET_RPC, "--port", String(port), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 150; i++) {
      try {
        await test().getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    deploymentFile = `local-e2e-${port}.json`;
    execFileSync(
      "forge",
      ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--unlocked", "--sender", ADMIN],
      { cwd: CONTRACTS, env: { ...process.env, DEV_TOKENS: "true", KEEPER, DEPLOYMENT_FILE: deploymentFile }, stdio: "pipe" },
    );
    const deploymentPath = join(CONTRACTS, "deployments", deploymentFile);
    d = JSON.parse(readFileSync(deploymentPath, "utf8"));

    await write(ALICE, d.collection, devChogAbi, "mint", [ALICE]); // #1
    await write(BOB, d.collection, devChogAbi, "mint", [BOB]); // #2

    dataDir = mkdtempSync(join(tmpdir(), "chogworld-e2e-"));
    const env = loadEnv({
      CHAIN_ID: String(monadTestnet.id),
      RPC_URL: rpc,
      DEPLOYMENT_JSON: deploymentPath,
      KEEPER_PRIVATE_KEY: KEEPER_KEY,
      PGLITE_DIR: dataDir,
      AGENT_LLM_ENABLED: "false",
      AGENT_ENABLED: "true",
      LOG_RANGE: "1000",
    });
    ctx = await buildContext(env, () => undefined);
  });

  afterAll(async () => {
    await ctx?.dbHandle.close();
    anvil?.kill();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (deploymentFile) rmSync(join(CONTRACTS, "deployments", deploymentFile), { force: true });
  });

  it("onboards two Chogs and the indexer sees them enrolled", async () => {
    await onboard(ALICE, 1n, 300n * 10n ** 18n);
    await onboard(BOB, 2n, 300n * 10n ** 18n);
    await ctx.indexer.run();
    const rows = await ctx.dbHandle.db.select().from(chogs);
    expect(rows.map((r) => r.tokenId).sort()).toEqual(["1", "2"]);
    expect(rows.every((r) => r.enrolled)).toBe(true);
    const journal = await ctx.journal.list(rows[0]!.key);
    expect(journal.map((j) => j.title)).toContain("Handed the reins to its agent");
  });

  it("the agent acts on its own, the resolver settles, the journal tells the story", async () => {
    const results = await ctx.agent.sweep(new Date(Date.now() + 60_000));
    expect(results).toHaveLength(2);
    for (const r of results) expect(["executed", "rested"]).toContain(r.status);
    expect(results.some((r) => r.status === "executed")).toBe(true);

    const executed = await ctx.dbHandle.db.select().from(actions).where(eq(actions.status, "executed"));
    expect(executed.length).toBeGreaterThan(0);
    for (const a of executed) expect(a.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    await ctx.indexer.run();
    await test().mine({ blocks: 3 });
    expect(await ctx.resolver.run()).toBeGreaterThan(0);
    await ctx.indexer.run();

    // Every quest or battle the agent started is now settled onchain and in the journal.
    expect(await ctx.dbHandle.db.select().from(questRuns).where(eq(questRuns.status, "active"))).toHaveLength(0);
    expect(await ctx.dbHandle.db.select().from(battles).where(eq(battles.status, "pending"))).toHaveLength(0);
    // Resolved battles replay exactly: the indexer only stores stats whose replay matches the onchain logHash.
    for (const b of await ctx.dbHandle.db.select().from(battles).where(eq(battles.status, "resolved"))) {
      expect(b.attStats).not.toBeNull();
      expect(simulate(b.attStats as Stats, b.defStats as Stats, b.seed as Hex).logHash).toBe(b.logHash);
    }
    const actingKeys = [...new Set(executed.map((a) => a.chogKey))];
    for (const key of actingKeys) {
      const titles = (await ctx.journal.list(key, { limit: 30 })).map((j) => j.title);
      expect(titles.some((t) => /^(Cleared|Beaten|Beat Chog|Lost to|Held off|Lost a defense|Bought)/.test(t) || t.includes("fizzled"))).toBe(true);
      const [row] = await ctx.dbHandle.db.select().from(chogs).where(eq(chogs.key, key));
      const onchain = await ctx.reader.snapshot(BigInt(row!.tokenId));
      // The indexer's cache matches the chain.
      expect({ xp: row!.xp, level: row!.level, rep: row!.rep, quests: row!.quests }).toEqual({
        xp: onchain.character.xp,
        level: onchain.character.level,
        rep: onchain.character.rep,
        quests: onchain.character.quests,
      });
    }
  });

  it("enforces the onchain budget: spend never exceeds the daily cap", async () => {
    for (let i = 0; i < 6; i++) {
      await ctx.agent.sweep(new Date(Date.now() + (i + 2) * 3_600_000));
      await ctx.indexer.run();
      await test().mine({ blocks: 3 });
      await ctx.resolver.run();
      await ctx.indexer.run();
    }
    const s = await ctx.reader.snapshot(1n);
    expect(s.policy.dailyCap - s.policy.remaining).toBeLessThanOrEqual(s.policy.dailyCap);
    expect(s.policy.actionsToday).toBeLessThanOrEqual(s.policy.maxActionsPerDay);
  });

  it("selling the Chog stops the agent, and its assets stay with the Chog", async () => {
    const account = await ctx.reader.accountOf(1n);
    const balance = await test().readContract({ address: d.chogToken, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    await write(ALICE, d.collection, devChogAbi, "transferFrom", [ALICE, CAROL, 1n]);

    const r = await ctx.agent.tick(1n);
    expect(r).toMatchObject({ status: "skipped", note: "owner changed" });
    const key = await ctx.reader.keyOf(1n);
    const [row] = await ctx.dbHandle.db.select().from(chogs).where(eq(chogs.key, key));
    expect(row!.enrolled).toBe(false);
    expect(await test().readContract({ address: d.chogToken, abi: erc20Abi, functionName: "balanceOf", args: [account] })).toBe(balance);
  });
});
