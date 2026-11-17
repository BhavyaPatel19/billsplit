import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  ActivityListResponseSchema,
  ActivityPayloadSchema,
  ActivityQuerySchema,
  type Activity,
  type ActivityPayload,
} from "@billsplit/contracts";
import { requireMembership } from "../lib/authorize.js";
import { badRequest } from "../lib/errors.js";
import { ParticipantResolver } from "../lib/ledger.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

type Cursor = { at: Date; id: string };

/** Opaque to clients: the position of the last entry they saw. */
const encodeCursor = (c: Cursor) =>
  Buffer.from(`${c.at.toISOString()}|${c.id}`).toString("base64url");

function decodeCursor(raw: string): Cursor {
  const [at, id] = Buffer.from(raw, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw badRequest("Invalid cursor");
  }
  return { at: date, id };
}

/** Re-point participant ids inside an entry at whoever they are now (after merges). */
function resolvePayload(p: ActivityPayload, r: ParticipantResolver): ActivityPayload {
  switch (p.kind) {
    case "expense.added":
    case "expense.edited":
    case "expense.deleted":
      return { ...p, data: { ...p.data, payerId: r.resolve(p.data.payerId) } };
    case "payment.recorded":
    case "payment.removed":
      return {
        ...p,
        data: { ...p.data, fromId: r.resolve(p.data.fromId), toId: r.resolve(p.data.toId) },
      };
    case "member.merged":
      return { ...p, data: { ...p.data, intoId: r.resolve(p.data.intoId) } };
    case "member.joined":
      return p;
  }
}

export function activityRoutes(db: Db) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/activity", requireSession);

  router.get(
    "/groups/:id/activity",
    describeRoute({
      tags: ["activity"],
      summary: "What happened in the group, newest first",
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: resolver(ActivityListResponseSchema) } },
        },
      },
    }),
    validate("query", ActivityQuerySchema),
    async (c) => {
      const { group, me } = await requireMembership(
        db,
        c.get("session")!.user.id,
        c.req.param("id"),
      );
      const { cursor, limit } = c.req.valid("query");
      const after = cursor ? decodeCursor(cursor) : null;

      const [rows, people] = await Promise.all([
        db
          .select()
          .from(schema.activities)
          .where(
            and(
              eq(schema.activities.groupId, group.id),
              after
                ? or(
                    lt(schema.activities.createdAt, after.at),
                    and(
                      eq(schema.activities.createdAt, after.at),
                      lt(schema.activities.id, after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(schema.activities.createdAt), desc(schema.activities.id))
          .limit(limit + 1),
        ParticipantResolver.forGroup(db, group.id),
      ]);

      const page = rows.slice(0, limit);
      const activities: Activity[] = [];
      for (const row of page) {
        const parsed = ActivityPayloadSchema.safeParse({ kind: row.kind, data: row.data });
        // An entry written by a newer version of the app is skipped rather than failing the feed.
        if (!parsed.success) continue;
        activities.push({
          id: row.id,
          actorId: row.actorParticipantId ? people.resolve(row.actorParticipantId) : null,
          subjectId: row.subjectId,
          involvesMe: row.involved.some((pid) => people.resolve(pid) === me.id),
          createdAt: row.createdAt.toISOString(),
          ...resolvePayload(parsed.data, people),
        });
      }
      const last = page.at(-1);
      return c.json(
        {
          activities,
          next:
            rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
        },
        200,
      );
    },
  );

  return router;
}
