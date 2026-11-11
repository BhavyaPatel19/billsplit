import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  BalancesResponseSchema,
  CreateSettlementBodySchema,
  ExpenseDetailSchema,
  ExpenseInputSchema,
  ExpenseListResponseSchema,
  SettlementListResponseSchema,
  SettlementSchema,
  type ExpenseInput,
  type Settlement,
} from "@billsplit/contracts";
import { requireMembership } from "../lib/authorize.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import {
  compute,
  groupBalances,
  isUniqueViolation,
  loadExpenses,
  ParticipantResolver,
  toDetail,
  toSummary,
} from "../lib/ledger.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

type Ctx = Context<{ Variables: SessionVariables }>;

const json = (s: Parameters<typeof resolver>[0]) => ({
  "application/json": { schema: resolver(s) },
});

/** Optional Idempotency-Key header: a retried create with the same key returns the original. */
function idempotencyKey(c: Ctx): string | null {
  const key = c.req.header("idempotency-key")?.trim();
  if (!key) return null;
  if (key.length > 100) throw badRequest("Idempotency-Key must be at most 100 characters");
  return key;
}

const today = () => new Date().toISOString().slice(0, 10);

export function expenseRoutes(db: Db) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/expenses", requireSession);
  router.use("/groups/:id/expenses/*", requireSession);
  router.use("/groups/:id/balances", requireSession);
  router.use("/groups/:id/settlements", requireSession);
  router.use("/groups/:id/settlements/*", requireSession);

  const detail = async (groupId: string, expenseId: string) => {
    const [row] = await loadExpenses(db, groupId, expenseId);
    if (!row) throw notFound("Expense not found");
    const resolver = await ParticipantResolver.forGroup(db, groupId);
    return toDetail(row.expense, row.version, row.shares, resolver);
  };

  /** Insert a new version (1 for a new expense) with its shares and make it current. */
  const writeVersion = async (
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    expenseId: string,
    version: number,
    body: ExpenseInput,
    currency: string,
    meId: string,
    active: ReadonlySet<string>,
  ) => {
    const stored: ExpenseInput = { ...body, spentOn: body.spentOn ?? today() };
    const { breakdown, shares } = compute(stored, currency, active);
    const [row] = await tx
      .insert(schema.expenseVersions)
      .values({
        expenseId,
        version,
        description: stored.description,
        currency,
        spentOn: stored.spentOn!,
        payerId: stored.payerId,
        totalCents: breakdown.total,
        input: stored,
        createdBy: meId,
      })
      .returning({ id: schema.expenseVersions.id });
    await tx.insert(schema.expenseShares).values(shares.map((s) => ({ versionId: row!.id, ...s })));
    await tx
      .update(schema.expenses)
      .set({ currentVersionId: row!.id })
      .where(eq(schema.expenses.id, expenseId));
  };

  // ---- expenses ----------------------------------------------------------------------------

  router.get(
    "/groups/:id/expenses",
    describeRoute({
      tags: ["expenses"],
      summary: "Expenses in a group, newest first",
      responses: { 200: { description: "OK", content: json(ExpenseListResponseSchema) } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const [rows, resolver] = await Promise.all([
        loadExpenses(db, group.id),
        ParticipantResolver.forGroup(db, group.id),
      ]);
      return c.json(
        { expenses: rows.map((r) => toSummary(r.expense, r.version, r.shares, resolver)) },
        200,
      );
    },
  );

  router.post(
    "/groups/:id/expenses",
    describeRoute({
      tags: ["expenses"],
      summary: "Add an expense",
      description:
        "Items carry their own split (equal, exact, percent such as a 10% bite, or shares). Tax, tip, fees and discounts are allocated proportionally to what each person had unless stated otherwise. Send an Idempotency-Key header to make retries safe.",
      responses: {
        201: { description: "Created", content: json(ExpenseDetailSchema) },
        200: { description: "Replay of an earlier request with the same Idempotency-Key" },
        400: { description: "Invalid split" },
      },
    }),
    validate("json", ExpenseInputSchema),
    async (c) => {
      const { group, me } = await requireMembership(
        db,
        c.get("session")!.user.id,
        c.req.param("id"),
      );
      const body = c.req.valid("json");
      const key = idempotencyKey(c);

      const replay = async () => {
        if (!key) return null;
        const [existing] = await db
          .select({ id: schema.expenses.id })
          .from(schema.expenses)
          .where(
            and(eq(schema.expenses.groupId, group.id), eq(schema.expenses.idempotencyKey, key)),
          )
          .limit(1);
        return existing ? c.json(await detail(group.id, existing.id), 200) : null;
      };

      const earlier = await replay();
      if (earlier) return earlier;

      const resolver = await ParticipantResolver.forGroup(db, group.id);
      try {
        const expenseId = await db.transaction(async (tx) => {
          const [expense] = await tx
            .insert(schema.expenses)
            .values({ groupId: group.id, createdBy: me.id, idempotencyKey: key })
            .returning({ id: schema.expenses.id });
          await writeVersion(tx, expense!.id, 1, body, group.currency, me.id, resolver.active);
          return expense!.id;
        });
        return c.json(await detail(group.id, expenseId), 201);
      } catch (err) {
        if (isUniqueViolation(err, "expenses_group_idempotency_uidx")) {
          const raced = await replay();
          if (raced) return raced;
        }
        throw err;
      }
    },
  );

  router.get(
    "/groups/:id/expenses/:expenseId",
    describeRoute({
      tags: ["expenses"],
      summary: "One expense with its per-item breakdown",
      responses: {
        200: { description: "OK", content: json(ExpenseDetailSchema) },
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      return c.json(await detail(group.id, c.req.param("expenseId")), 200);
    },
  );

  router.put(
    "/groups/:id/expenses/:expenseId",
    describeRoute({
      tags: ["expenses"],
      summary: "Edit an expense (creates a new version)",
      responses: { 200: { description: "OK", content: json(ExpenseDetailSchema) } },
    }),
    validate("json", ExpenseInputSchema),
    async (c) => {
      const { group, me } = await requireMembership(
        db,
        c.get("session")!.user.id,
        c.req.param("id"),
      );
      const [current] = await loadExpenses(db, group.id, c.req.param("expenseId"));
      if (!current) throw notFound("Expense not found");
      const resolver = await ParticipantResolver.forGroup(db, group.id);
      await db.transaction((tx) =>
        writeVersion(
          tx,
          current.expense.id,
          current.version.version + 1,
          c.req.valid("json"),
          current.version.currency,
          me.id,
          resolver.active,
        ),
      );
      return c.json(await detail(group.id, current.expense.id), 200);
    },
  );

  router.delete(
    "/groups/:id/expenses/:expenseId",
    describeRoute({
      tags: ["expenses"],
      summary: "Delete an expense",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const [row] = await db
        .update(schema.expenses)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.expenses.id, c.req.param("expenseId")),
            eq(schema.expenses.groupId, group.id),
            isNull(schema.expenses.deletedAt),
          ),
        )
        .returning({ id: schema.expenses.id });
      if (!row) throw notFound("Expense not found");
      return c.body(null, 204);
    },
  );

  // ---- balances ----------------------------------------------------------------------------

  router.get(
    "/groups/:id/balances",
    describeRoute({
      tags: ["balances"],
      summary: "Who owes whom",
      description: "Net balance per person and the fewest payments that settle the group.",
      responses: { 200: { description: "OK", content: json(BalancesResponseSchema) } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const resolver = await ParticipantResolver.forGroup(db, group.id);
      return c.json(await groupBalances(db, group.id, group.currency, resolver), 200);
    },
  );

  // ---- settlements -------------------------------------------------------------------------

  const toSettlement = (
    s: typeof schema.settlements.$inferSelect,
    r: ParticipantResolver,
  ): Settlement => ({
    id: s.id,
    fromId: r.resolve(s.fromId),
    toId: r.resolve(s.toId),
    amountCents: s.amountCents,
    currency: s.currency,
    note: s.note,
    createdAt: s.createdAt.toISOString(),
  });

  router.get(
    "/groups/:id/settlements",
    describeRoute({
      tags: ["settlements"],
      summary: "Recorded payments",
      responses: { 200: { description: "OK", content: json(SettlementListResponseSchema) } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const [rows, resolver] = await Promise.all([
        db
          .select()
          .from(schema.settlements)
          .where(
            and(eq(schema.settlements.groupId, group.id), isNull(schema.settlements.deletedAt)),
          )
          .orderBy(desc(schema.settlements.createdAt))
          .limit(500),
        ParticipantResolver.forGroup(db, group.id),
      ]);
      return c.json({ settlements: rows.map((s) => toSettlement(s, resolver)) }, 200);
    },
  );

  router.post(
    "/groups/:id/settlements",
    describeRoute({
      tags: ["settlements"],
      summary: "Record a payment",
      description:
        "Money moves outside BillSplit (Venmo, Zelle, cash); this records it. Send an Idempotency-Key header to make retries safe.",
      responses: { 201: { description: "Recorded", content: json(SettlementSchema) } },
    }),
    validate("json", CreateSettlementBodySchema),
    async (c) => {
      const { group, me } = await requireMembership(
        db,
        c.get("session")!.user.id,
        c.req.param("id"),
      );
      const body = c.req.valid("json");
      const key = idempotencyKey(c);
      const resolver = await ParticipantResolver.forGroup(db, group.id);
      for (const id of [body.fromId, body.toId]) {
        if (!resolver.active.has(id)) throw badRequest("Both people must be in the group");
      }

      const replay = async () => {
        if (!key) return null;
        const [existing] = await db
          .select()
          .from(schema.settlements)
          .where(
            and(
              eq(schema.settlements.groupId, group.id),
              eq(schema.settlements.idempotencyKey, key),
            ),
          )
          .limit(1);
        return existing ? c.json(toSettlement(existing, resolver), 200) : null;
      };
      const earlier = await replay();
      if (earlier) return earlier;

      try {
        const [row] = await db
          .insert(schema.settlements)
          .values({
            groupId: group.id,
            fromId: body.fromId,
            toId: body.toId,
            amountCents: body.amountCents,
            currency: group.currency,
            note: body.note ?? null,
            createdBy: me.id,
            idempotencyKey: key,
          })
          .returning();
        return c.json(toSettlement(row!, resolver), 201);
      } catch (err) {
        if (isUniqueViolation(err, "settlements_group_idempotency_uidx")) {
          const raced = await replay();
          if (raced) return raced;
        }
        throw err;
      }
    },
  );

  router.delete(
    "/groups/:id/settlements/:settlementId",
    describeRoute({
      tags: ["settlements"],
      summary: "Undo a recorded payment (whoever recorded it, or the owner)",
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      const { group, me } = await requireMembership(
        db,
        c.get("session")!.user.id,
        c.req.param("id"),
      );
      const [row] = await db
        .select()
        .from(schema.settlements)
        .where(
          and(
            eq(schema.settlements.id, c.req.param("settlementId")),
            eq(schema.settlements.groupId, group.id),
            isNull(schema.settlements.deletedAt),
          ),
        )
        .limit(1);
      if (!row) throw notFound("Payment not found");
      if (row.createdBy !== me.id && me.role !== "owner")
        throw forbidden("Only whoever recorded it can undo it");
      await db
        .update(schema.settlements)
        .set({ deletedAt: new Date() })
        .where(eq(schema.settlements.id, row.id));
      return c.body(null, 204);
    },
  );

  return router;
}
