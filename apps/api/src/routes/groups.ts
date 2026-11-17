import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  AuditActionSchema,
  AuditLogResponseSchema,
  CreateGroupBodySchema,
  CreateInviteBodySchema,
  CreateParticipantBodySchema,
  GroupDetailSchema,
  GroupListResponseSchema,
  InviteListResponseSchema,
  InviteSchema,
  MergeParticipantBodySchema,
  ParticipantSchema,
  UpdateGroupBodySchema,
  UpdateParticipantBodySchema,
  type AuditLogResponse,
  type GroupDetail,
  type GroupSummary,
  type Invite,
  type Participant,
} from "@billsplit/contracts";
import type { Env } from "../env.js";
import { recordAudit } from "../lib/audit.js";
import { requireMembership, requireOwner } from "../lib/authorize.js";
import type { ClaimEvents } from "../lib/claim-events.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { hasHistory } from "../lib/ledger.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

type ParticipantRow = typeof schema.participants.$inferSelect;
type InviteRow = typeof schema.invites.$inferSelect;

const idParam = {
  params: [
    {
      name: "id",
      in: "path" as const,
      required: true,
      schema: { type: "string" as const, format: "uuid" },
    },
  ],
};

export function groupRoutes(db: Db, env: Env, claimEvents: ClaimEvents) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups", requireSession);
  router.use("/groups/*", requireSession);

  const activeParticipants = (groupId: string) =>
    db
      .select()
      .from(schema.participants)
      .where(
        and(eq(schema.participants.groupId, groupId), isNull(schema.participants.mergedIntoId)),
      )
      .orderBy(schema.participants.createdAt);

  const toParticipant = (p: ParticipantRow, userId: string): Participant => ({
    id: p.id,
    displayName: p.displayName,
    userId: p.userId,
    role: p.role,
    isPlaceholder: p.userId === null,
    isMe: p.userId === userId,
    createdAt: p.createdAt.toISOString(),
  });

  const toInvite = (i: InviteRow): Invite => ({
    id: i.id,
    code: i.code,
    url: `${env.APP_URL}/join/${i.code}`,
    expiresAt: i.expiresAt.toISOString(),
    maxUses: i.maxUses,
    uses: i.uses,
    participantId: i.participantId,
    createdAt: i.createdAt.toISOString(),
  });

  const detail = async (groupId: string, userId: string): Promise<GroupDetail> => {
    const { group, me } = await requireMembership(db, userId, groupId);
    const participants = await activeParticipants(groupId);
    return {
      id: group.id,
      name: group.name,
      currency: group.currency,
      memberCount: participants.length,
      myParticipantId: me.id,
      myRole: me.role,
      createdAt: group.createdAt.toISOString(),
      participants: participants.map((p) => toParticipant(p, userId)),
    };
  };

  // ---- groups ------------------------------------------------------------------------------

  router.get(
    "/groups",
    describeRoute({
      tags: ["groups"],
      summary: "Groups I belong to",
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: resolver(GroupListResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const counts = db
        .select({ groupId: schema.participants.groupId, n: count().as("n") })
        .from(schema.participants)
        .where(isNull(schema.participants.mergedIntoId))
        .groupBy(schema.participants.groupId)
        .as("counts");
      const rows = await db
        .select({ group: schema.groups, me: schema.participants, n: counts.n })
        .from(schema.participants)
        .innerJoin(schema.groups, eq(schema.groups.id, schema.participants.groupId))
        .innerJoin(counts, eq(counts.groupId, schema.groups.id))
        .where(
          and(
            eq(schema.participants.userId, userId),
            isNull(schema.participants.mergedIntoId),
            isNull(schema.groups.deletedAt),
          ),
        )
        .orderBy(sql`${schema.groups.createdAt} desc`);
      const groups: GroupSummary[] = rows.map(({ group, me, n }) => ({
        id: group.id,
        name: group.name,
        currency: group.currency,
        memberCount: Number(n),
        myParticipantId: me.id,
        myRole: me.role,
        createdAt: group.createdAt.toISOString(),
      }));
      return c.json({ groups }, 200);
    },
  );

  router.post(
    "/groups",
    describeRoute({
      tags: ["groups"],
      summary: "Create a group",
      description: "The creator becomes the owner participant.",
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: resolver(GroupDetailSchema) } },
        },
      },
    }),
    validate("json", CreateGroupBodySchema),
    async (c) => {
      const { user } = c.get("session")!;
      const body = c.req.valid("json");
      const groupId = await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(schema.groups)
          .values({ name: body.name, currency: body.currency, createdBy: user.id })
          .returning({ id: schema.groups.id });
        await tx.insert(schema.participants).values({
          groupId: group!.id,
          userId: user.id,
          displayName: user.name,
          role: "owner",
        });
        return group!.id;
      });
      return c.json(await detail(groupId, user.id), 201);
    },
  );

  router.get(
    "/groups/:id",
    describeRoute({
      tags: ["groups"],
      summary: "Group with its participants",
      ...idParam,
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: resolver(GroupDetailSchema) } },
        },
        404: { description: "Not a member or no such group" },
      },
    }),
    async (c) => c.json(await detail(c.req.param("id"), c.get("session")!.user.id), 200),
  );

  router.patch(
    "/groups/:id",
    describeRoute({
      tags: ["groups"],
      summary: "Rename or change currency (owner)",
      ...idParam,
      responses: { 200: { description: "OK" } },
    }),
    validate("json", UpdateGroupBodySchema),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const { group } = await requireOwner(db, userId, c.req.param("id"));
      await db.update(schema.groups).set(c.req.valid("json")).where(eq(schema.groups.id, group.id));
      return c.json(await detail(group.id, userId), 200);
    },
  );

  router.delete(
    "/groups/:id",
    describeRoute({
      tags: ["groups"],
      summary: "Delete a group (owner; soft delete)",
      ...idParam,
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const { group } = await requireOwner(db, c.get("session")!.user.id, c.req.param("id"));
      await db
        .update(schema.groups)
        .set({ deletedAt: new Date() })
        .where(eq(schema.groups.id, group.id));
      return c.body(null, 204);
    },
  );

  // ---- participants ------------------------------------------------------------------------

  router.post(
    "/groups/:id/participants",
    describeRoute({
      tags: ["participants"],
      summary: "Add a placeholder person (no account yet)",
      ...idParam,
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: resolver(ParticipantSchema) } },
        },
      },
    }),
    validate("json", CreateParticipantBodySchema),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const { group } = await requireMembership(db, userId, c.req.param("id"));
      const { displayName } = c.req.valid("json");
      const [row] = await db
        .insert(schema.participants)
        .values({ groupId: group.id, displayName, role: "member" })
        .returning();
      return c.json(toParticipant(row!, userId), 201);
    },
  );

  router.patch(
    "/groups/:id/participants/:pid",
    describeRoute({
      tags: ["participants"],
      summary: "Rename a participant (owner, or yourself)",
      responses: { 200: { description: "OK" } },
    }),
    validate("json", UpdateParticipantBodySchema),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const { group, me } = await requireMembership(db, userId, c.req.param("id"));
      const target = await findActive(db, group.id, c.req.param("pid"));
      if (target.id !== me.id && me.role !== "owner") throw forbidden();
      const [row] = await db
        .update(schema.participants)
        .set({ displayName: c.req.valid("json").displayName })
        .where(eq(schema.participants.id, target.id))
        .returning();
      return c.json(toParticipant(row!, userId), 200);
    },
  );

  router.delete(
    "/groups/:id/participants/:pid",
    describeRoute({
      tags: ["participants"],
      summary: "Remove a placeholder (owner) or leave the group (yourself, non-owner)",
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const { group, me } = await requireMembership(db, userId, c.req.param("id"));
      const target = await findActive(db, group.id, c.req.param("pid"));
      if (target.id === me.id) {
        if (me.role === "owner")
          throw conflict("Transfer ownership or delete the group instead of leaving");
      } else if (me.role !== "owner") {
        throw forbidden("Only the owner can remove people");
      } else if (target.userId !== null) {
        throw conflict("Members leave on their own; only placeholders can be removed");
      }
      if (await hasHistory(db, target.id)) {
        throw conflict(
          target.userId === null
            ? "This person is part of existing expenses. Merge them into a member instead."
            : "You are part of existing expenses. Settle up and ask the owner before leaving.",
        );
      }
      await db.delete(schema.participants).where(eq(schema.participants.id, target.id));
      return c.body(null, 204);
    },
  );

  router.post(
    "/groups/:id/participants/:pid/merge",
    describeRoute({
      tags: ["participants"],
      summary: "Merge a placeholder into a participant with an account (owner)",
      description:
        "The placeholder keeps its rows (history still references it) but is hidden and resolves to the target; its receipt claims move to the target. Repeating a merge that already happened returns 200 again.",
      responses: {
        200: {
          description: "Merged",
          content: { "application/json": { schema: resolver(ParticipantSchema) } },
        },
      },
    }),
    validate("json", MergeParticipantBodySchema),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const { group, me } = await requireOwner(db, userId, c.req.param("id"));
      const sourceId = c.req.param("pid");
      const targetId = c.req.valid("json").intoParticipantId;
      if (!isUuid(sourceId)) throw notFound("Participant not found");
      if (sourceId === targetId) throw badRequest("Cannot merge a participant into itself");

      const result = await db.transaction(async (tx) => {
        // Lock both rows, always in id order, so two merges of the same placeholder (or a
        // merge racing an invite that claims it) run one after the other and cannot deadlock.
        // NO KEY UPDATE, because only non-key columns change: a plain FOR UPDATE would also
        // block the foreign-key checks that other merges' audit and claim rows make against
        // these participants, and two merges into each other's rows would deadlock.
        const rows = await tx
          .select()
          .from(schema.participants)
          .where(
            and(
              eq(schema.participants.groupId, group.id),
              inArray(schema.participants.id, [sourceId, targetId]),
            ),
          )
          .orderBy(schema.participants.id)
          .for("no key update");
        const source = rows.find((p) => p.id === sourceId);
        const target = rows.find((p) => p.id === targetId);
        if (!source || !target || target.mergedIntoId) throw notFound("Participant not found");
        // Asking again for a merge that already happened is a success, not an error.
        if (source.mergedIntoId === target.id) return { target, receiptIds: [] };
        if (source.mergedIntoId) {
          throw conflict("That placeholder was already merged into someone else");
        }
        if (source.userId !== null) throw conflict("Only placeholders can be merged");
        if (target.userId === null) throw conflict("Merge target must have an account");

        await tx
          .update(schema.participants)
          .set({ mergedIntoId: target.id })
          .where(eq(schema.participants.id, source.id));
        // Invites that pointed at the placeholder now claim nothing special.
        await tx
          .update(schema.invites)
          .set({ participantId: null })
          .where(eq(schema.invites.participantId, source.id));

        // Receipt claims follow the person. Where the account already claimed the same line
        // itself, its own claim stands and the placeholder's is dropped, which also keeps a
        // line from going over 100%.
        const claims = await tx
          .select()
          .from(schema.receiptClaims)
          .where(inArray(schema.receiptClaims.participantId, [source.id, target.id]));
        const targetLines = new Set(
          claims
            .filter((cl) => cl.participantId === target.id)
            .map((cl) => `${cl.receiptId}:${cl.itemIndex}`),
        );
        const sourceClaims = claims.filter((cl) => cl.participantId === source.id);
        const dropped = sourceClaims.filter((cl) =>
          targetLines.has(`${cl.receiptId}:${cl.itemIndex}`),
        );
        if (dropped.length > 0) {
          await tx.delete(schema.receiptClaims).where(
            inArray(
              schema.receiptClaims.id,
              dropped.map((cl) => cl.id),
            ),
          );
        }
        await tx
          .update(schema.receiptClaims)
          .set({ participantId: target.id })
          .where(eq(schema.receiptClaims.participantId, source.id));

        await recordAudit(tx, {
          groupId: group.id,
          actorUserId: userId,
          actorParticipantId: me.id,
          action: "participant.merged",
          details: {
            placeholderId: source.id,
            placeholderName: source.displayName,
            intoParticipantId: target.id,
            intoName: target.displayName,
            claimsMoved: sourceClaims.length - dropped.length,
            claimsDropped: dropped.length,
          },
        });
        return { target, receiptIds: [...new Set(sourceClaims.map((cl) => cl.receiptId))] };
      });
      // Open receipt pages show the claims under their new owner straight away.
      for (const receiptId of result.receiptIds) claimEvents.publish(receiptId);
      return c.json(toParticipant(result.target, userId), 200);
    },
  );

  router.get(
    "/groups/:id/audit-log",
    describeRoute({
      tags: ["groups"],
      summary: "Who merged or took over which placeholder, newest first (owner)",
      ...idParam,
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: resolver(AuditLogResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const { group } = await requireOwner(db, c.get("session")!.user.id, c.req.param("id"));
      const rows = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.groupId, group.id))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(100);
      const body: AuditLogResponse = {
        entries: rows.map((r) => ({
          id: r.id,
          action: AuditActionSchema.parse(r.action),
          actorParticipantId: r.actorParticipantId,
          details: r.details,
          createdAt: r.createdAt.toISOString(),
        })),
      };
      return c.json(body, 200);
    },
  );

  // ---- invites -----------------------------------------------------------------------------

  router.get(
    "/groups/:id/invites",
    describeRoute({
      tags: ["invites"],
      summary: "Active invites (owner)",
      ...idParam,
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: resolver(InviteListResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const { group } = await requireOwner(db, c.get("session")!.user.id, c.req.param("id"));
      const rows = await db
        .select()
        .from(schema.invites)
        .where(and(eq(schema.invites.groupId, group.id), isNull(schema.invites.revokedAt)))
        .orderBy(sql`${schema.invites.createdAt} desc`);
      return c.json({ invites: rows.map(toInvite) }, 200);
    },
  );

  router.post(
    "/groups/:id/invites",
    describeRoute({
      tags: ["invites"],
      summary: "Create an invite link",
      description:
        "Any member can invite. Optionally bind the invite to a placeholder so the person who accepts it takes over that placeholder.",
      ...idParam,
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: resolver(InviteSchema) } },
        },
      },
    }),
    validate("json", CreateInviteBodySchema),
    async (c) => {
      const userId = c.get("session")!.user.id;
      const { group, me } = await requireMembership(db, userId, c.req.param("id"));
      const body = c.req.valid("json");
      if (body.participantId) {
        const placeholder = await findActive(db, group.id, body.participantId);
        if (placeholder.userId !== null) throw conflict("That person already has an account");
      }
      const [row] = await db
        .insert(schema.invites)
        .values({
          groupId: group.id,
          code: randomBytes(9).toString("base64url"),
          createdBy: me.id,
          participantId: body.participantId ?? null,
          expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
          maxUses: body.maxUses ?? null,
        })
        .returning();
      return c.json(toInvite(row!), 201);
    },
  );

  router.delete(
    "/groups/:id/invites/:inviteId",
    describeRoute({
      tags: ["invites"],
      summary: "Revoke an invite (owner)",
      responses: { 204: { description: "Revoked" } },
    }),
    async (c) => {
      const { group } = await requireOwner(db, c.get("session")!.user.id, c.req.param("id"));
      if (!isUuid(c.req.param("inviteId"))) throw notFound("Invite not found");
      const [row] = await db
        .update(schema.invites)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(schema.invites.id, c.req.param("inviteId")), eq(schema.invites.groupId, group.id)),
        )
        .returning({ id: schema.invites.id });
      if (!row) throw notFound("Invite not found");
      return c.body(null, 204);
    },
  );

  return router;
}

async function findActive(db: Db, groupId: string, participantId: string): Promise<ParticipantRow> {
  if (!isUuid(participantId)) throw notFound("Participant not found");
  const [row] = await db
    .select()
    .from(schema.participants)
    .where(
      and(
        eq(schema.participants.id, participantId),
        eq(schema.participants.groupId, groupId),
        isNull(schema.participants.mergedIntoId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Participant not found");
  return row;
}
