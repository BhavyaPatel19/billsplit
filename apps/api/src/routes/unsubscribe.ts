import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import { UnsubscribeStatusSchema, type UnsubscribeStatus } from "@billsplit/contracts";
import { notFound } from "../lib/errors.js";

/** "ana@example.com" -> "an•••@example.com". */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain}`;
}

/**
 * Unsubscribe without signing in. The token in every email's footer is the credential; it
 * can only turn email off, so a leaked token does little harm. GET never changes anything,
 * because link scanners in mail systems open links: only the button on the page, or a mail
 * client's one-click unsubscribe (RFC 8058, a POST), does.
 */
export function unsubscribeRoutes(db: Db) {
  const router = new Hono();

  const load = async (token: string) => {
    const [row] = await db
      .select({ prefs: schema.notificationPrefs, email: schema.users.email })
      .from(schema.notificationPrefs)
      .innerJoin(schema.users, eq(schema.users.id, schema.notificationPrefs.userId))
      .where(eq(schema.notificationPrefs.unsubscribeToken, token))
      .limit(1);
    if (!row) throw notFound("Unsubscribe link not found");
    return row;
  };
  const toStatus = (row: Awaited<ReturnType<typeof load>>): UnsubscribeStatus => ({
    email: maskEmail(row.email),
    prefs: { activityEmails: row.prefs.activityEmails, reminderEmails: row.prefs.reminderEmails },
  });
  const json = { "application/json": { schema: resolver(UnsubscribeStatusSchema) } };

  router.get(
    "/unsubscribe/:token",
    describeRoute({
      tags: ["account"],
      summary: "What an unsubscribe link would turn off (no sign-in, changes nothing)",
      responses: { 200: { description: "OK", content: json }, 404: { description: "Unknown" } },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(toStatus(await load(c.req.param("token"))), 200);
    },
  );

  router.post(
    "/unsubscribe/:token",
    describeRoute({
      tags: ["account"],
      summary: "Turn off every BillSplit email for the link's owner (no sign-in)",
      responses: { 200: { description: "Unsubscribed", content: json } },
    }),
    async (c) => {
      const row = await load(c.req.param("token"));
      await db
        .update(schema.notificationPrefs)
        .set({ activityEmails: false, reminderEmails: false })
        .where(eq(schema.notificationPrefs.userId, row.prefs.userId));
      return c.json(
        toStatus({ ...row, prefs: { ...row.prefs, activityEmails: false, reminderEmails: false } }),
        200,
      );
    },
  );

  return router;
}
