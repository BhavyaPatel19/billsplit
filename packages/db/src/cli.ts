// CLI entry: applies pending migrations and exits. Used by the `migrate` Compose service
// (`node node_modules/@billsplit/db/dist/cli.js`) and by `pnpm --filter @billsplit/db migrate`.
import { runMigrations } from "./migrate.js";

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
