import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver as zodResolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  AwayPeriodSchema,
  CreateAwayBodySchema,
  HouseholdResidentSchema,
  HouseholdResponseSchema,
  HouseholdSplitQuerySchema,
  HouseholdSplitSchema,
  UpdateResidentBodySchema,
  type AwayPeriod,
  type HouseholdResident,
} from "@billsplit/contracts";
import { requireMembership, type Membership } from "../lib/authorize.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { householdSnapshot } from "../lib/household.js";
import { isUuid } from "../lib/ids.js";
import { ParticipantResolver } from "../lib/ledger.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

const json = (s: Parameters<typeof zodResolver>[0]) => ({
  "application/json": { schema: zodResolver(s) },
});

type ResidentRow = typeof schema.householdResidents.$inferSelect;
type AwayRow = typeof schema.awayPeriods.$inferSelect;

const toResident = (participantId: string, row?: ResidentRow): HouseholdResident => ({
  participantId,
  roomWeight: row?.roomWeight ?? 1,
  movedInOn: row?.movedInOn ?? null,
  movedOutOn: row?.movedOutOn ?? null,
});

const toAway = (a: AwayRow, r: ParticipantResolver): AwayPeriod => ({
  id: a.id,
  participantId: r.resolve(a.participantId),
  from: a.fromOn,
  to: a.toOn,
  note: a.note,
});

/** Your own details, or anyone's (placeholders included) if you own the group. */
function requireSelfOrOwner(m: Membership, participantId: string) {
  if (participantId !== m.me.id && m.me.role !== "owner")
    throw forbidden("Only the owner can change someone else's details");
}

export function householdRoutes(db: Db) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/household", requireSession);
  router.use("/groups/:id/household/*", requireSession);

  const member = async (userId: string, groupId: string) => {
    const m = await requireMembership(db, userId, groupId);
    return { m, resolver: await ParticipantResolver.forGroup(db, m.group.id) };
  };

  router.get(
    "/groups/:id/household",
    describeRoute({
      tags: ["household"],
      summary: "Room weights, move dates and trips",
      responses: { 200: { description: "OK", content: json(HouseholdResponseSchema) } },
    }),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const [rows, away] = await Promise.all([
        db
          .select()
          .from(schema.householdResidents)
          .where(eq(schema.householdResidents.groupId, m.group.id)),
        db
          .select()
          .from(schema.awayPeriods)
          .where(eq(schema.awayPeriods.groupId, m.group.id))
          .orderBy(asc(schema.awayPeriods.fromOn))
          .limit(500),
      ]);
      const byId = new Map(rows.map((r) => [r.participantId, r]));
      return c.json(
        {
          residents: [...resolver.active].map((id) => toResident(id, byId.get(id))),
          away: away
            .filter((a) => resolver.active.has(resolver.resolve(a.participantId)))
            .map((a) => toAway(a, resolver)),
        },
        200,
      );
    },
  );

  router.patch(
    "/groups/:id/household/residents/:pid",
    describeRoute({
      tags: ["household"],
      summary: "Set someone's room weight or move dates (yourself, or anyone as owner)",
      description:
        "Copied into household bills when they are created; bills already saved keep the numbers they were made with.",
      responses: { 200: { description: "OK", content: json(HouseholdResidentSchema) } },
    }),
    validate("json", UpdateResidentBodySchema),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const pid = c.req.param("pid");
      if (!isUuid(pid) || !resolver.active.has(pid)) throw notFound("Participant not found");
      requireSelfOrOwner(m, pid);
      const body = c.req.valid("json");

      const t = schema.householdResidents;
      const row = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(t).where(eq(t.participantId, pid)).for("update");
        const next = {
          roomWeight: body.roomWeight ?? current?.roomWeight ?? 1,
          movedInOn: body.movedInOn === undefined ? (current?.movedInOn ?? null) : body.movedInOn,
          movedOutOn:
            body.movedOutOn === undefined ? (current?.movedOutOn ?? null) : body.movedOutOn,
        };
        if (next.movedInOn && next.movedOutOn && next.movedOutOn < next.movedInOn)
          throw badRequest("Move-out must be on or after move-in");
        const [saved] = await tx
          .insert(t)
          .values({ participantId: pid, groupId: m.group.id, ...next })
          .onConflictDoUpdate({ target: t.participantId, set: next })
          .returning();
        return saved!;
      });
      return c.json(toResident(pid, row), 200);
    },
  );

  router.post(
    "/groups/:id/household/away",
    describeRoute({
      tags: ["household"],
      summary: "Record days away (yourself, or anyone as owner)",
      description: "Days away come off usage-based household bills such as utilities, not rent.",
      responses: { 201: { description: "Recorded", content: json(AwayPeriodSchema) } },
    }),
    validate("json", CreateAwayBodySchema),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const body = c.req.valid("json");
      if (!resolver.active.has(body.participantId))
        throw badRequest("That person is not in the group");
      requireSelfOrOwner(m, body.participantId);
      const [row] = await db
        .insert(schema.awayPeriods)
        .values({
          groupId: m.group.id,
          participantId: body.participantId,
          fromOn: body.from,
          toOn: body.to,
          note: body.note ?? null,
          createdBy: m.me.id,
        })
        .returning();
      return c.json(toAway(row!, resolver), 201);
    },
  );

  router.delete(
    "/groups/:id/household/away/:awayId",
    describeRoute({
      tags: ["household"],
      summary: "Remove days away",
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const awayId = c.req.param("awayId");
      if (!isUuid(awayId)) throw notFound("Not found");
      const [row] = await db
        .select()
        .from(schema.awayPeriods)
        .where(and(eq(schema.awayPeriods.id, awayId), eq(schema.awayPeriods.groupId, m.group.id)))
        .limit(1);
      if (!row) throw notFound("Not found");
      requireSelfOrOwner(m, resolver.resolve(row.participantId));
      await db.delete(schema.awayPeriods).where(eq(schema.awayPeriods.id, row.id));
      return c.body(null, 204);
    },
  );

  router.get(
    "/groups/:id/household/split",
    describeRoute({
      tags: ["household"],
      summary: "A household split for a period, from the current settings",
      description:
        "Use it as an item's split. `rent` weighs rooms and days living there; `usage` counts days present, so trips come off.",
      responses: {
        200: { description: "OK", content: json(HouseholdSplitSchema) },
        409: { description: "Nobody lived there during the period" },
      },
    }),
    validate("query", HouseholdSplitQuerySchema),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const q = c.req.valid("query");
      const split = await householdSnapshot(db, m.group.id, resolver, {
        basis: q.basis,
        period: { from: q.from, to: q.to },
      });
      if (!split) throw conflict("Nobody lived there during that period");
      return c.json(split, 200);
    },
  );

  return router;
}
