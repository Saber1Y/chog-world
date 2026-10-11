CREATE TABLE "actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"chog_key" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"cost" text NOT NULL,
	"status" text NOT NULL,
	"decided_by" text NOT NULL,
	"thought" text,
	"reason" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"battle_id" text PRIMARY KEY NOT NULL,
	"att_key" text NOT NULL,
	"def_key" text NOT NULL,
	"tier" integer NOT NULL,
	"fee" text NOT NULL,
	"start_block" bigint NOT NULL,
	"status" text NOT NULL,
	"attacker_won" boolean,
	"seed" text,
	"log_hash" text,
	"rounds" integer,
	"rep_delta" integer,
	"payout" text,
	"att_stats" jsonb,
	"def_stats" jsonb,
	"resolve_block" bigint,
	"resolve_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chogs" (
	"key" text PRIMARY KEY NOT NULL,
	"collection" text NOT NULL,
	"token_id" text NOT NULL,
	"account" text NOT NULL,
	"owner" text,
	"enrolled" boolean DEFAULT false NOT NULL,
	"goal_mask" integer DEFAULT 0 NOT NULL,
	"nickname" text,
	"personality" text,
	"next_tick_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_tick_at" timestamp with time zone,
	"last_tick_note" text,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"rep" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"quests" integer DEFAULT 0 NOT NULL,
	"titles" integer DEFAULT 0 NOT NULL,
	"scars" integer DEFAULT 0 NOT NULL,
	"earned" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"chog_key" text NOT NULL,
	"from_time" timestamp with time zone NOT NULL,
	"to_time" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"written_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"contract" text NOT NULL,
	"name" text NOT NULL,
	"chog_key" text,
	"args" jsonb NOT NULL,
	"block_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"token_id" integer PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"chog_key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"tx_hash" text,
	"block_number" bigint,
	"source_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"chog_key" text NOT NULL,
	"quest_id" integer NOT NULL,
	"start_block" bigint NOT NULL,
	"status" text NOT NULL,
	"won" boolean,
	"late" boolean,
	"xp" integer,
	"reward" text,
	"loot_id" integer,
	"seed" text,
	"resolve_tx" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "actions_action_id_idx" ON "actions" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "actions_chog_idx" ON "actions" USING btree ("chog_key","created_at");--> statement-breakpoint
CREATE INDEX "battles_att_idx" ON "battles" USING btree ("att_key");--> statement-breakpoint
CREATE INDEX "battles_def_idx" ON "battles" USING btree ("def_key");--> statement-breakpoint
CREATE INDEX "battles_status_idx" ON "battles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chogs_owner_idx" ON "chogs" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "chogs_next_tick_idx" ON "chogs" USING btree ("next_tick_at");--> statement-breakpoint
CREATE INDEX "chogs_rep_idx" ON "chogs" USING btree ("rep");--> statement-breakpoint
CREATE INDEX "chogs_level_idx" ON "chogs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "digests_chog_idx" ON "digests" USING btree ("chog_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "events_tx_log_idx" ON "events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "events_chog_idx" ON "events" USING btree ("chog_key","block_number");--> statement-breakpoint
CREATE INDEX "events_name_idx" ON "events" USING btree ("name","block_number");--> statement-breakpoint
CREATE INDEX "holders_owner_idx" ON "holders" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_source_idx" ON "journal_entries" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "journal_chog_idx" ON "journal_entries" USING btree ("chog_key","created_at");--> statement-breakpoint
CREATE INDEX "quest_runs_chog_idx" ON "quest_runs" USING btree ("chog_key");--> statement-breakpoint
CREATE INDEX "quest_runs_status_idx" ON "quest_runs" USING btree ("status");