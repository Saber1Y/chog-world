import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** One row per awakened Chog this backend knows about. Chain state is the authority; this is a cache plus agent bookkeeping. */
export const chogs = pgTable(
  "chogs",
  {
    key: text("key").primaryKey(),
    collection: text("collection").notNull(),
    tokenId: text("token_id").notNull(),
    account: text("account").notNull(),
    owner: text("owner"),
    enrolled: boolean("enrolled").notNull().default(false),
    goalMask: integer("goal_mask").notNull().default(0),
    nickname: text("nickname"),
    personality: text("personality"),
    nextTickAt: timestamp("next_tick_at", { withTimezone: true }).notNull().defaultNow(),
    lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
    lastTickNote: text("last_tick_note"),
    // Progression cache maintained by the indexer from ChogState events (chain is the authority).
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    rep: integer("rep").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    quests: integer("quests").notNull().default(0),
    titles: integer("titles").notNull().default(0),
    scars: integer("scars").notNull().default(0),
    earned: text("earned").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chogs_owner_idx").on(t.owner),
    index("chogs_next_tick_idx").on(t.nextTickAt),
    index("chogs_rep_idx").on(t.rep),
    index("chogs_level_idx").on(t.level),
  ],
);

/** Every action the agent decided on, and what became of it. */
export const actions = pgTable(
  "actions",
  {
    id: serial("id").primaryKey(),
    actionId: text("action_id").notNull(),
    chogKey: text("chog_key").notNull(),
    kind: text("kind").notNull(),
    params: jsonb("params").notNull(),
    cost: text("cost").notNull(),
    status: text("status").notNull(), // decided | submitted | executed | blocked | failed
    decidedBy: text("decided_by").notNull(), // llm | heuristic
    thought: text("thought"),
    reason: text("reason"),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("actions_action_id_idx").on(t.actionId), index("actions_chog_idx").on(t.chogKey, t.createdAt)],
);

/** Raw decoded contract events, the source for journals, battles and leaderboards. */
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: text("tx_hash").notNull(),
    contract: text("contract").notNull(),
    name: text("name").notNull(),
    chogKey: text("chog_key"),
    args: jsonb("args").notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_tx_log_idx").on(t.txHash, t.logIndex),
    index("events_chog_idx").on(t.chogKey, t.blockNumber),
    index("events_name_idx").on(t.name, t.blockNumber),
  ],
);

export const questRuns = pgTable(
  "quest_runs",
  {
    runId: text("run_id").primaryKey(),
    chogKey: text("chog_key").notNull(),
    questId: integer("quest_id").notNull(),
    startBlock: bigint("start_block", { mode: "number" }).notNull(),
    status: text("status").notNull(), // active | resolved
    won: boolean("won"),
    late: boolean("late"),
    xp: integer("xp"),
    reward: text("reward"),
    lootId: integer("loot_id"),
    seed: text("seed"),
    resolveTx: text("resolve_tx"),
  },
  (t) => [index("quest_runs_chog_idx").on(t.chogKey), index("quest_runs_status_idx").on(t.status)],
);

export const battles = pgTable(
  "battles",
  {
    battleId: text("battle_id").primaryKey(),
    attKey: text("att_key").notNull(),
    defKey: text("def_key").notNull(),
    tier: integer("tier").notNull(),
    fee: text("fee").notNull(),
    startBlock: bigint("start_block", { mode: "number" }).notNull(),
    status: text("status").notNull(), // pending | resolved | voided
    attackerWon: boolean("attacker_won"),
    seed: text("seed"),
    logHash: text("log_hash"),
    rounds: integer("rounds"),
    repDelta: integer("rep_delta"),
    payout: text("payout"),
    /** Combat stats both sides fought with, read at the block before resolution, for replays. */
    attStats: jsonb("att_stats"),
    defStats: jsonb("def_stats"),
    resolveBlock: bigint("resolve_block", { mode: "number" }),
    resolveTx: text("resolve_tx"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("battles_att_idx").on(t.attKey), index("battles_def_idx").on(t.defKey), index("battles_status_idx").on(t.status)],
);

/** Human-readable story of each Chog, written from events and agent decisions. */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    chogKey: text("chog_key").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data"),
    txHash: text("tx_hash"),
    blockNumber: bigint("block_number", { mode: "number" }),
    /** Dedup key so replays of the same event never double-write. */
    sourceKey: text("source_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("journal_source_idx").on(t.sourceKey), index("journal_chog_idx").on(t.chogKey, t.createdAt)],
);

export const digests = pgTable(
  "digests",
  {
    id: serial("id").primaryKey(),
    chogKey: text("chog_key").notNull(),
    fromTime: timestamp("from_time", { withTimezone: true }).notNull(),
    toTime: timestamp("to_time", { withTimezone: true }).notNull(),
    text: text("text").notNull(),
    writtenBy: text("written_by").notNull(), // llm | template
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("digests_chog_idx").on(t.chogKey, t.createdAt)],
);

export const cursors = pgTable("cursors", {
  name: text("name").primaryKey(),
  block: bigint("block", { mode: "number" }).notNull(),
});

/** Last known owner of each token in the collection, refreshed by the holders sweep. */
export const holders = pgTable(
  "holders",
  {
    tokenId: integer("token_id").primaryKey(),
    owner: text("owner").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("holders_owner_idx").on(t.owner)],
);
