import { serve } from "@hono/node-server";
import { createDb } from "@billsplit/db";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { createMailer } from "./email.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const logger = createLogger(env);
const dbHandle = createDb({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
const mailer = createMailer(env, logger);
const auth = createAuth({ env, db: dbHandle.db, mailer, logger });
const app = createApp({ env, logger, db: dbHandle.db, auth });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    { port: info.port, env: env.NODE_ENV, email: env.EMAIL_TRANSPORT, appUrl: env.APP_URL },
    "api listening",
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close((err) => {
    void dbHandle.close().finally(() => {
      if (err) {
        logger.error({ err }, "error during shutdown");
        process.exit(1);
      }
      process.exit(0);
    });
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
