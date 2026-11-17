import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  MeResponseSchema,
  NotificationPrefsSchema,
  UpdateNotificationPrefsBodySchema,
  type MeResponse,
  type NotificationPrefs,
} from "@billsplit/contracts";
import { validate } from "../lib/validate.js";
import type { Notifier } from "../notifications.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

export function meRoutes(db: Db, notifier: Notifier) {
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

  const json = { "application/json": { schema: resolver(NotificationPrefsSchema) } };
  const toPrefs = (p: NotificationPrefs): NotificationPrefs => ({
    activityEmails: p.activityEmails,
    reminderEmails: p.reminderEmails,
  });

  router.get(
    "/me/notifications",
    describeRoute({
      tags: ["account"],
      summary: "Which emails you get",
      responses: { 200: { description: "OK", content: json } },
    }),
    requireSession,
    async (c) => {
      const userId = c.get("session")!.user.id;
      const prefs = (await notifier.prefsFor([userId])).get(userId)!;
      return c.json(toPrefs(prefs), 200);
    },
  );

  router.patch(
    "/me/notifications",
    describeRoute({
      tags: ["account"],
      summary: "Turn email types on or off",
      responses: { 200: { description: "OK", content: json } },
    }),
    requireSession,
    validate("json", UpdateNotificationPrefsBodySchema),
    async (c) => {
      const userId = c.get("session")!.user.id;
      await notifier.prefsFor([userId]);
      const [row] = await db
        .update(schema.notificationPrefs)
        .set(c.req.valid("json"))
        .where(eq(schema.notificationPrefs.userId, userId))
        .returning();
      return c.json(toPrefs(row!), 200);
    },
  );

  return router;
}
