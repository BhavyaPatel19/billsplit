import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { openAPIRouteHandler } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import { healthRoutes } from "./routes/health.js";

export interface AppDeps {
  env: Env;
  logger: Logger;
  startedAt?: Date;
}

export type AppVariables = {
  requestId: string;
};

export function createApp({ env, logger, startedAt = new Date() }: AppDeps) {
  const app = new Hono<{ Variables: AppVariables }>();

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

  app.route("/", healthRoutes({ env, startedAt }));

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
    logger.error({ err, requestId: c.get("requestId") }, "unhandled error");
    return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
