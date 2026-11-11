import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, runMigrations, type DbHandle } from "@billsplit/db";
import pino from "pino";
import { createApp, type App } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { InMemoryMailer } from "../src/email.js";
import { loadEnv, type Env } from "../src/env.js";

export interface TestContext {
  app: App;
  env: Env;
  mailer: InMemoryMailer;
  db: DbHandle;
  stop(): Promise<void>;
}

/** Boots Postgres in a container, migrates it and builds the API with an in-memory mailer. */
export async function startTestContext(overrides: NodeJS.ProcessEnv = {}): Promise<TestContext> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17-alpine",
  ).start();
  const connectionString = container.getConnectionUri();
  await runMigrations(connectionString);

  const env = loadEnv({
    NODE_ENV: "test",
    APP_VERSION: "test-sha",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: connectionString,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-test-secret",
    EMAIL_TRANSPORT: "log",
    ...overrides,
  });
  const logger = pino({ enabled: false });
  const db = createDb({ connectionString, max: 3 });
  const mailer = new InMemoryMailer();
  const auth = createAuth({ env, db: db.db, mailer, logger });
  const app = createApp({ env, logger, db: db.db, auth });

  return {
    app,
    env,
    mailer,
    db,
    stop: async () => {
      await db.close();
      await container.stop();
    },
  };
}

/** Request helper that behaves like the browser on the app origin. */
export function jsonRequest(
  app: App,
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
) {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  };
  if (init.cookie) headers.cookie = init.cookie;
  return app.request(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Joins every Set-Cookie of a response into a Cookie header value. */
export function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

/** First http(s) URL found in a text. */
export function firstUrl(text: string): string {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error(`no url in: ${text}`);
  return match[0];
}

/** Sign up, follow the emailed verification link, and return the session cookie. */
export async function signUpVerified(
  ctx: TestContext,
  name: string,
  email: string,
): Promise<string> {
  const res = await jsonRequest(ctx.app, "/api/auth/sign-up/email", {
    body: { name, email, password: `${name}-passphrase-123` },
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`);
  const url = firstUrl(ctx.mailer.lastTo(email)!.text);
  const verified = await ctx.app.request(url.replace("http://localhost:3000", ""), {
    headers: { origin: "http://localhost:3000" },
  });
  const cookie = cookiesOf(verified);
  if (!cookie.includes("session_token")) throw new Error("verification did not sign in");
  return cookie;
}

/** jsonRequest with optional extra headers (e.g. Idempotency-Key). */
export function request(
  app: App,
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
    ...init.headers,
  };
  if (init.cookie) headers.cookie = init.cookie;
  return app.request(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
