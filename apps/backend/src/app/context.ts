import Anthropic from "@anthropic-ai/sdk";
import { formatEther, parseEther } from "viem";
import type { Env } from "../config/env.js";
import { openDatabase, type DbHandle } from "../database/db.js";
import { ChainService } from "../chain/chain.js";
import { chogOperatorAbi } from "@chog-world/shared";
import { WorldReader } from "../world/reader.js";
import { Journal } from "../journal/journal.js";
import { Digests } from "../journal/digest.js";
import { Indexer } from "../indexer/indexer.js";
import { Resolver } from "../resolver/resolver.js";
import { Holders } from "../holders/holders.js";
import { Executor } from "../agent/executor.js";
import { Agent } from "../agent/agent.js";
import { ClaudeDecider, HeuristicDecider, type Decider } from "../agent/decider.js";
import { Renderer } from "../render/render.js";

/** Composition root: every service, built once from the environment. Nest controllers receive this. */
export interface AppContext {
  env: Env;
  dbHandle: DbHandle;
  chain: ChainService;
  reader: WorldReader;
  journal: Journal;
  digests: Digests;
  indexer: Indexer;
  resolver: Resolver;
  holders: Holders;
  agent: Agent;
  renderer: Renderer;
  llmEnabled: boolean;
}

export const APP_CONTEXT = Symbol("APP_CONTEXT");

export async function buildContext(env: Env, log: (scope: string, msg: string) => void): Promise<AppContext> {
  const dbHandle = await openDatabase({ databaseUrl: env.DATABASE_URL, pgliteDir: env.PGLITE_DIR });
  const db = dbHandle.db;
  const chain = new ChainService(env);
  await chain.verify(() =>
    chain.publicClient.readContract({ address: chain.deployment.operator, abi: chogOperatorAbi, functionName: "keeper" }),
  );

  const reader = new WorldReader(chain.publicClient, chain.deployment);
  const journal = new Journal(db);

  const llmEnabled = env.AGENT_LLM_ENABLED;
  // The SDK resolves credentials itself (ANTHROPIC_API_KEY, auth token or an `ant auth login` profile).
  const anthropic = llmEnabled ? new Anthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}) : null;
  const decider: Decider = anthropic ? new ClaudeDecider(anthropic, env.AGENT_MODEL, env.AGENT_LLM_TIMEOUT_MS) : new HeuristicDecider();
  const digests = new Digests(db, journal, anthropic ? { client: anthropic, model: env.AGENT_MODEL, timeoutMs: env.AGENT_LLM_TIMEOUT_MS } : null);

  const keeperMin = parseEther(env.KEEPER_MIN_BALANCE);
  const indexer = new Indexer(db, chain.publicClient, chain.deployment, journal, env.LOG_RANGE, (m) => log("indexer", m));
  const resolver = new Resolver(db, chain.publicClient, chain.resolver, chain.deployment, (m) => log("resolver", m));
  const holders = new Holders(db, chain.publicClient, chain.deployment, env.COLLECTION_SUPPLY);
  const executor = new Executor(db, chain.keeper, chain.deployment);
  const agent = new Agent(
    db,
    reader,
    decider,
    executor,
    journal,
    chain.deployment,
    { tickMinutes: env.TICK_MINUTES, movesPerDay: env.MOVES_PER_DAY, restMinutes: env.REST_MINUTES, batchSize: 20, scoutCount: 6 },
    (m) => log("agent", m),
    async () => {
      const balance = await chain.keeperBalance();
      if (balance < keeperMin)
        return { ok: false as const, reason: `keeper balance ${formatEther(balance)} MON is below ${env.KEEPER_MIN_BALANCE} MON; top it up` };
      // The resolver only sees indexed runs and battles, and their seeds expire after 256 blocks:
      // a move started while the indexer is catching up (after a restart) would fizzle or be voided.
      const lag = Number(await chain.publicClient.getBlockNumber()) - (await indexer.cursor());
      if (lag > env.MAX_INDEX_LAG) return { ok: false as const, reason: `indexer is ${lag} blocks behind; waiting for it to catch up` };
      return { ok: true as const };
    },
  );

  const renderer = new Renderer(env.ART_CACHE_PATH);

  return { env, dbHandle, chain, reader, journal, digests, indexer, resolver, holders, agent, renderer, llmEnabled };
}
