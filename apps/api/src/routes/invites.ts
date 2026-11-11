import { and, count, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  AcceptInviteResponseSchema,
  InvitePreviewSchema,
  type AcceptInviteResponse,
  type InvitePreview,
  type InviteStatus,
} from "@billsplit/contracts";
import { gone, notFound } from "../lib/errors.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

type InviteRow = typeof schema.invites.$inferSelect;

function inviteStatus(invite: InviteRow, placeholderClaimed: boolean): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() < Date.now()) return "expired";
  if (placeholderClaimed) return "claimed";
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "exhausted";
  return "valid";
}

/** Join flow for invite links: /join/<code> on the web. */
export function inviteRoutes(db: Db) {
  const router = new Hono<{ Variables: SessionVariables }>();

  const load = async (code: string) => {
    const [row] = await db
      .select({ invite: schema.invites, group: schema.groups, placeholder: schema.participants })
      .from(schema.invites)
      .innerJoin(schema.groups, eq(schema.groups.id, schema.invites.groupId))
      .leftJoin(schema.participants, eq(schema.participants.id, schema.invites.participantId))
      .where(and(eq(schema.invites.code, code), isNull(schema.groups.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Invite not found");
    const placeholderClaimed =
      row.placeholder !== null &&
      (row.placeholder.userId !== null || row.placeholder.mergedIntoId !== null);
    return { ...row, status: inviteStatus(row.invite, placeholderClaimed) };
  };

  router.get(
    "/invites/:code",
    describeRoute({
      tags: ["invites"],
      summary: "Preview an invite (no sign-in needed)",
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: resolver(InvitePreviewSchema) } },
        },
        404: { description: "Unknown code" },
      },
    }),
    async (c) => {
      const { invite, group, placeholder, status } = await load(c.req.param("code"));
      const counted = await db
        .select({ n: count() })
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.groupId, invite.groupId),
            isNull(schema.participants.mergedIntoId),
          ),
        );
      const body: InvitePreview = {
        groupName: group.name,
        memberCount: Number(counted[0]?.n ?? 0),
        placeholderName: status === "valid" && placeholder ? placeholder.displayName : null,
        status,
      };
      return c.json(body, 200);
    },
  );

  router.post(
    "/invites/:code/accept",
    describeRoute({
      tags: ["invites"],
      summary: "Join the group behind an invite",
      description:
        "Idempotent for existing members. If the invite is bound to a placeholder, the caller takes it over (its history becomes theirs); otherwise a new participant is created.",
      responses: {
        200: {
          description: "Joined or already a member",
          content: { "application/json": { schema: resolver(AcceptInviteResponseSchema) } },
        },
        410: { description: "Invite expired, revoked, exhausted or already claimed" },
      },
    }),
    requireSession,
    async (c) => {
      const { user } = c.get("session")!;
      const { invite, placeholder, status } = await load(c.req.param("code"));

      const [existing] = await db
        .select({ id: schema.participants.id })
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.groupId, invite.groupId),
            eq(schema.participants.userId, user.id),
            isNull(schema.participants.mergedIntoId),
          ),
        )
        .limit(1);
      if (existing) {
        const body: AcceptInviteResponse = {
          groupId: invite.groupId,
          participantId: existing.id,
          alreadyMember: true,
        };
        return c.json(body, 200);
      }
      if (status !== "valid") throw gone(`This invite is ${status}`);

      const participantId = await db.transaction(async (tx) => {
        // Consume a use atomically; a concurrent acceptor past max_uses gets nothing back.
        const [consumed] = await tx
          .update(schema.invites)
          .set({ uses: sql`${schema.invites.uses} + 1` })
          .where(
            and(
              eq(schema.invites.id, invite.id),
              isNull(schema.invites.revokedAt),
              sql`(${schema.invites.maxUses} is null or ${schema.invites.uses} < ${schema.invites.maxUses})`,
            ),
          )
          .returning({ id: schema.invites.id });
        if (!consumed) throw gone("This invite is exhausted");

        if (placeholder) {
          // Claim the placeholder: same row, so every split it appears in is now the user's.
          const [claimed] = await tx
            .update(schema.participants)
            .set({ userId: user.id })
            .where(
              and(eq(schema.participants.id, placeholder.id), isNull(schema.participants.userId)),
            )
            .returning({ id: schema.participants.id });
          if (!claimed) throw gone("This invite is claimed");
          return claimed.id;
        }
        const [created] = await tx
          .insert(schema.participants)
          .values({
            groupId: invite.groupId,
            userId: user.id,
            displayName: user.name,
            role: "member",
          })
          .returning({ id: schema.participants.id });
        return created!.id;
      });

      const body: AcceptInviteResponse = {
        groupId: invite.groupId,
        participantId,
        alreadyMember: false,
      };
      return c.json(body, 200);
    },
  );

  return router;
}
