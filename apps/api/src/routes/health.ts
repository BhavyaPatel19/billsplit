import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  type HealthResponse,
  type ReadinessCheck,
  type ReadinessResponse,
} from "@billsplit/contracts";
import type { Env } from "../env.js";

export interface HealthDeps {
  env: Env;
  startedAt: Date;
  /** Readiness probes (database, cache, ...). Each resolves to a check result. */
  probes?: Array<() => Promise<ReadinessCheck>>;
}

export function healthRoutes({ env, startedAt, probes = [] }: HealthDeps) {
  const router = new Hono();

  router.get(
    "/healthz",
    describeRoute({
      tags: ["ops"],
      summary: "Liveness probe",
      description: "Returns 200 when the process is up. Does not check dependencies.",
      responses: {
        200: {
          description: "Service is alive",
          content: { "application/json": { schema: resolver(HealthResponseSchema) } },
        },
      },
    }),
    (c) => {
      const body: HealthResponse = {
        status: "ok",
        service: "billsplit-api",
        version: env.APP_VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      };
      return c.json(body, 200);
    },
  );

  router.get(
    "/readyz",
    describeRoute({
      tags: ["ops"],
      summary: "Readiness probe",
      description: "Runs dependency checks. 200 when all pass, 503 when any fail.",
      responses: {
        200: {
          description: "All checks passed",
          content: { "application/json": { schema: resolver(ReadinessResponseSchema) } },
        },
        503: {
          description: "At least one check failed",
          content: { "application/json": { schema: resolver(ReadinessResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const checks = await Promise.all(probes.map((p) => p()));
      const allOk = checks.every((ch) => ch.ok);
      const body: ReadinessResponse = { status: allOk ? "ready" : "degraded", checks };
      return c.json(body, allOk ? 200 : 503);
    },
  );

  return router;
}
