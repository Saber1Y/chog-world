import { z } from "zod";
import { isAddress, isHex, type Address, type Hex } from "viem";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const address = z.string().refine(isAddress, "must be an address").transform((v) => v as Address);
const privateKey = z
  .string()
  .refine((v) => isHex(v) && v.length === 66, "must be a 32-byte hex private key")
  .transform((v) => v as Hex);

/**
 * Validated once at boot so a missing key fails loudly on startup. Never log the parsed result:
 * it holds the keeper key and the Anthropic key.
 */
export const envSchema = z.object({
  PORT: z.coerce.number().int().default(9100),
  /** Interface to bind; 127.0.0.1 when a reverse proxy on the same host fronts the API. */
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:3100"),
  /** The public web app, shown on share cards. */
  SITE_URL: z.string().url().default("http://localhost:3100"),

  /** 143 mainnet, 10143 testnet, or an anvil fork of either. */
  CHAIN_ID: z.coerce.number().int().default(10143),
  RPC_URL: z.string().url().optional(),
  /** Path to a deployment JSON (e.g. contracts/deployments/local.json). Overrides the shared registry. */
  DEPLOYMENT_JSON: z.string().optional(),

  /** Only key allowed to call ChogOperator. Holds MON for gas, nothing else. */
  KEEPER_PRIVATE_KEY: privateKey,
  /** Optional separate unprivileged key for resolving quests and battles. Defaults to the keeper. */
  RESOLVER_PRIVATE_KEY: privateKey.optional(),

  DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  PGLITE_DIR: z.string().default("./.data/chogworld"),

  /**
   * Language models that decide and narrate, tried in this order. Each one is used only when its key
   * is set; with none, the agent runs on the heuristic decider and templated digests.
   */
  LLM_PROVIDERS: z.string().default("gemini,openrouter,claude"),
  /** Google AI Studio key, used through Gemini's OpenAI-compatible endpoint. */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai"),
  OPENROUTER_API_KEY: z.string().optional(),
  /** `openrouter/free` routes to whichever free model is available. */
  OPENROUTER_MODEL: z.string().default("openrouter/free"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** The Claude model, when Claude is among the providers. */
  AGENT_MODEL: z.string().default("claude-sonnet-5-5"),
  AGENT_LLM_ENABLED: bool,
  AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(20_000),

  /** Minutes between ticks for each Chog. */
  TICK_MINUTES: z.coerce.number().min(0.25).default(15),
  /** Seconds between scheduler sweeps. */
  SCHEDULER_INTERVAL_SEC: z.coerce.number().int().min(5).default(60),
  AGENT_ENABLED: bool,
  /**
   * Below this keeper balance (in MON) the agent stops starting new moves, keeping the rest for
   * settling quests and battles already in flight.
   */
  KEEPER_MIN_BALANCE: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "must be a MON amount like 0.05")
    .default("0.05"),

  RESOLVE_INTERVAL_SEC: z.coerce.number().int().min(1).default(4),
  INDEX_INTERVAL_SEC: z.coerce.number().int().min(1).default(3),
  /** getLogs block span per request; Monad's public RPC rejects wide ranges. */
  LOG_RANGE: z.coerce.number().int().min(1).max(10_000).default(100),
  /** Most moves a Chog makes per day, however much its policy allows; spaced evenly to keep keeper gas bounded. */
  MOVES_PER_DAY: z.coerce.number().int().min(1).max(96).default(12),
  /** Minutes a Chog waits after resting before it reconsiders. */
  REST_MINUTES: z.coerce.number().int().min(1).default(60),
  /** Gas limit headroom over the estimate, in basis points. Monad charges the whole limit, so keep it small. */
  GAS_MARGIN_BPS: z.coerce.number().int().min(0).max(5_000).default(1_000),
  /** The agent starts no new moves while the indexer is further behind the head than this. */
  MAX_INDEX_LAG: z.coerce.number().int().min(1).max(200).default(60),
  HOLDERS_INTERVAL_SEC: z.coerce.number().int().min(30).default(300),
  /** How often the keeper checks for gas fees to withdraw, and the least worth a withdrawal (MON). */
  GAS_COLLECT_INTERVAL_SEC: z.coerce.number().int().min(30).default(600),
  GAS_WITHDRAW_MIN: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "must be a MON amount like 0.2")
    .default("0.2"),

  RPC_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(6),
  RPC_MAX_RPS: z.coerce.number().int().min(1).max(1000).default(15),

  /** Optional explicit collection size; read from the contract when it exposes totalSupply/nextId. */
  COLLECTION_SUPPLY: z.coerce.number().int().positive().optional(),

  KEEPER_ADDRESS_EXPECTED: address.optional(),

  /** Where the shared Chog art is cached after the first IPFS fetch. */
  ART_CACHE_PATH: z.string().default("./.data/chog-base.png"),
  /** Public base URL of this API, used for image links in metadata. */
  PUBLIC_URL: z.string().url().default("http://localhost:9100"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol("ENV");
