import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./lib/errors.js";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Db } from "@billsplit/db";
import type { ReadinessCheck } from "@billsplit/contracts";
import type { Auth } from "./auth.js";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import { sessionMiddleware, type SessionVariables } from "./middleware/session.js";
import { healthRoutes } from "./routes/health.js";
import { expenseRoutes } from "./routes/expenses.js";
import { groupRoutes } from "./routes/groups.js";
import { inviteRoutes } from "./routes/invites.js";
import { meRoutes } from "./routes/me.js";
import { metaRoutes } from "./routes/meta.js";

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Db;
  auth: Auth;
  startedAt?: Date;
}

export type AppVariables = SessionVariables;

export function createApp({ env, logger, db, auth, startedAt = new Date() }: AppDeps) {
  // Everything lives under /api so the reverse proxy and Next.js rewrites forward the prefix as-is.
  const app = new Hono<{ Variables: AppVariables }>().basePath("/api");

  app.use(requestId());
  app.use(secureHeaders());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request",
    );
  });

  const dbProbe = async (): Promise<ReadinessCheck> => {
    const start = performance.now();
    try {
      await db.execute(sql`select 1`);
      return { name: "postgres", ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      return { name: "postgres", ok: false, error: err instanceof Error ? err.message : "failed" };
    }
  };
  app.route("/", healthRoutes({ env, startedAt, probes: [dbProbe] }));
  app.route("/", metaRoutes(env));

  // Better Auth owns everything under /api/auth (sign-up, sign-in, verification, OAuth callbacks).
  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

  app.use("*", sessionMiddleware(auth));
  app.route("/", meRoutes());
  app.route("/", groupRoutes(db, env));
  app.route("/", expenseRoutes(db));
  app.route("/", inviteRoutes(db));

  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "BillSplit API",
          version: env.APP_VERSION,
          description: "Split bills with friends and roommates.",
        },
        servers: [{ url: "/", description: "Current host" }],
      },
    }),
  );
  app.get("/docs", Scalar({ url: "/openapi.json", theme: "kepler" }));

  app.notFound((c) => c.json({ error: "not_found", requestId: c.get("requestId") }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { error: err.message, requestId: c.get("requestId"), details: err.details },
        err.status,
      );
    }
    if (err instanceof HTTPException) {
      return c.json({ error: err.message, requestId: c.get("requestId") }, err.status);
    }
    logger.error({ err, requestId: c.get("requestId") }, "unhandled error");
    return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
