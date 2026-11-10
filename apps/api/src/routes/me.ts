import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { MeResponseSchema, type MeResponse } from "@billsplit/contracts";
import { requireSession, type SessionVariables } from "../middleware/session.js";

export function meRoutes() {
  const router = new Hono<{ Variables: SessionVariables }>();

  router.get(
    "/me",
    describeRoute({
      tags: ["account"],
      summary: "Current user",
      description: "The signed-in user and session. 401 when anonymous.",
      responses: {
        200: {
          description: "Signed in",
          content: { "application/json": { schema: resolver(MeResponseSchema) } },
        },
        401: { description: "Not signed in" },
      },
    }),
    requireSession,
    (c) => {
      const { user, session } = c.get("session")!;
      const body: MeResponse = {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image ?? null,
          createdAt: user.createdAt.toISOString(),
        },
        session: { expiresAt: session.expiresAt.toISOString() },
      };
      return c.json(body, 200);
    },
  );

  return router;
}
