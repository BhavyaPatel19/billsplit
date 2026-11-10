import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

/** Absolute path of the SQL migrations shipped with this package. */
export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

/** Apply every pending migration. Safe to run on every deploy; already-applied ones are skipped. */
export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb({ connectionString, max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}
