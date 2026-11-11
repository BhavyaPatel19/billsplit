import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { MetaResponseSchema, type MetaResponse } from "@billsplit/contracts";
import type { Env } from "../env.js";

/** Public, non-secret configuration for the web app. */
export function metaRoutes(env: Env) {
  const router = new Hono();

  router.get(
    "/meta",
    describeRoute({
      tags: ["ops"],
      summary: "Public configuration",
      responses: {
        200: {
          description: "Feature flags and version",
          content: { "application/json": { schema: resolver(MetaResponseSchema) } },
        },
      },
    }),
    (c) => {
      const body: MetaResponse = {
        version: env.APP_VERSION,
        features: { googleSignIn: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) },
      };
      return c.json(body, 200);
    },
  );

  return router;
}
