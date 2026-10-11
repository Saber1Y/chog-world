import Anthropic from "@anthropic-ai/sdk";
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
    { tickMinutes: env.TICK_MINUTES, batchSize: 20, scoutCount: 6 },
    (m) => log("agent", m),
  );

  return { env, dbHandle, chain, reader, journal, digests, indexer, resolver, holders, agent, llmEnabled };
}
