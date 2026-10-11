import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { Database } from "../database/db.js";
import { journalEntries } from "../database/schema.js";

export type JournalKind =
  | "thought"
  | "quest"
  | "battle"
  | "level"
  | "title"
  | "scar"
  | "zone"
  | "item"
  | "economy"
  | "policy"
  | "life";

export interface JournalInput {
  chogKey: string;
  kind: JournalKind;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
  txHash?: string | null;
  blockNumber?: number | null;
  /** Dedup key: writing the same source twice is a no-op. */
  sourceKey: string;
  createdAt?: Date;
}

export type JournalRow = typeof journalEntries.$inferSelect;
export type JournalListener = (row: JournalRow) => void;

/** The story of each Chog. Every write is idempotent on `sourceKey`, so replays never duplicate. */
export class Journal {
  private readonly listeners = new Set<JournalListener>();

  constructor(private readonly db: Database) {}

  onEntry(fn: JournalListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Writes an entry and notifies listeners. Pass `exec` (a transaction) to write inside it; then
   * nothing is emitted, and the caller emits with `emit` once the transaction commits.
   */
  async write(e: JournalInput, exec?: Database): Promise<JournalRow | undefined> {
    const [row] = await (exec ?? this.db)
      .insert(journalEntries)
      .values({
        chogKey: e.chogKey,
        kind: e.kind,
        title: e.title,
        body: e.body ?? null,
        data: e.data ?? null,
        txHash: e.txHash ?? null,
        blockNumber: e.blockNumber ?? null,
        sourceKey: e.sourceKey,
        ...(e.createdAt ? { createdAt: e.createdAt } : {}),
      })
      .onConflictDoNothing({ target: journalEntries.sourceKey })
      .returning();
    if (row && !exec) this.emit(row);
    return row;
  }

  emit(row: JournalRow): void {
    for (const fn of this.listeners) fn(row);
  }

  list(chogKey: string, opts: { limit?: number; beforeId?: number } = {}): Promise<JournalRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const where = opts.beforeId
      ? and(eq(journalEntries.chogKey, chogKey), lt(journalEntries.id, opts.beforeId))
      : eq(journalEntries.chogKey, chogKey);
    return this.db.select().from(journalEntries).where(where).orderBy(desc(journalEntries.id)).limit(limit);
  }

  since(chogKey: string, from: Date): Promise<JournalRow[]> {
    return this.db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.chogKey, chogKey), gte(journalEntries.createdAt, from)))
      .orderBy(journalEntries.id)
      .limit(300);
  }

  recentWorld(limit = 50): Promise<JournalRow[]> {
    return this.db
      .select()
      .from(journalEntries)
      .orderBy(desc(journalEntries.id))
      .limit(Math.min(Math.max(limit, 1), 200));
  }
}
