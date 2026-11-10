import { defineConfig } from "drizzle-kit";

// Used by `pnpm --filter @billsplit/db generate` to diff src/schema against the migrations
// folder. No database connection is needed for generate; `studio` and `push` read DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://billsplit:billsplit@localhost:5432/billsplit",
  },
});
