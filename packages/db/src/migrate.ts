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

// CLI entry: `node dist/migrate.js` (production) or `pnpm --filter @billsplit/db migrate` (dev).
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  runMigrations(url)
    .then(() => {
      console.log("migrations applied");
    })
    .catch((err: unknown) => {
      console.error("migration failed", err);
      process.exit(1);
    });
}
