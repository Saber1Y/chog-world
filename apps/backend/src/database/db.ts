import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

/** Both drivers give a Drizzle Postgres database over the same schema; nothing above here cares which. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Database;
  kind: "pg" | "pglite";
  close: () => Promise<void>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/**
 * `DATABASE_URL` set: real Postgres (production). Unset: PGlite, Postgres compiled to WASM running
 * in-process, so the stack runs with no database server. Same engine and SQL, but single-connection:
 * development only. `pgliteDir: null` keeps it in memory (tests).
 */
export async function openDatabase(opts: { databaseUrl?: string; pgliteDir: string | null }): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({
      connectionString: opts.databaseUrl,
      connectionTimeoutMillis: 15_000,
      query_timeout: 60_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    });
    // A dropped idle connection emits 'error'; unhandled, Node would exit the whole server.
    pool.on("error", () => undefined);
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as Database, kind: "pg", close: () => pool.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client: InstanceType<typeof PGlite>;
  if (opts.pgliteDir) {
    const dir = resolve(opts.pgliteDir);
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  } else {
    client = new PGlite();
  }
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Database, kind: "pglite", close: () => client.close() };
}

export const DB = Symbol("DB");
