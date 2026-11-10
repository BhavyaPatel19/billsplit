import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  /** Drain the pool; call on shutdown. */
  close(): Promise<void>;
}

export interface CreateDbOptions {
  connectionString: string;
  /** Pool size; the API uses a handful, workers one or two. */
  max?: number;
}

/**
 * Open a connection pool and wrap it in a typed Drizzle client. Column names are snake_case in
 * the database and camelCase in TypeScript (`casing: "snake_case"`).
 */
export function createDb({ connectionString, max = 10 }: CreateDbOptions): DbHandle {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
