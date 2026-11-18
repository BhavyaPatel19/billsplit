import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver as zodResolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  CreatePantryRunBodySchema,
  PantryListResponseSchema,
  PantryRunSchema,
  ReceiptOcrSchema,
  SetPantryUseBodySchema,
  type PantryRun,
} from "@billsplit/contracts";
import { recordActivity } from "../lib/activity.js";
import { requireMembership, type Membership } from "../lib/authorize.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { writeVersion } from "../lib/expense-writes.js";
import { isUuid } from "../lib/ids.js";
import { ParticipantResolver } from "../lib/ledger.js";
import { pantryExpenseInput } from "../lib/pantry.js";
import { todayUtc } from "../lib/schedule.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";
import type { Notifier } from "../notifications.js";

const json = (s: Parameters<typeof zodResolver>[0]) => ({
  "application/json": { schema: zodResolver(s) },
});

type RunRow = typeof schema.pantryRuns.$inferSelect;

export function pantryRoutes(db: Db, notifier: Notifier) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/pantry", requireSession);
  router.use("/groups/:id/pantry/*", requireSession);

  const member = async (userId: string, groupId: string) => {
    const m = await requireMembership(db, userId, groupId);
    return { m, resolver: await ParticipantResolver.forGroup(db, m.group.id) };
  };

  /** Runs with their items and uses, in API shape. */
  const present = async (runs: RunRow[], r: ParticipantResolver): Promise<PantryRun[]> => {
    if (runs.length === 0) return [];
    const items = await db
      .select()
      .from(schema.pantryItems)
      .where(
        inArray(
          schema.pantryItems.runId,
          runs.map((x) => x.id),
        ),
      )
      .orderBy(asc(schema.pantryItems.position));
    const uses = items.length
      ? await db
          .select()
          .from(schema.pantryUses)
          .where(
            inArray(
              schema.pantryUses.itemId,
              items.map((i) => i.id),
            ),
          )
      : [];
    return runs.map((run) => {
      const mine = items.filter((i) => i.runId === run.id);
      const itemsTotal = mine.reduce((n, i) => n + i.amountCents, 0);
      return {
        id: run.id,
        description: run.description,
        payerId: r.resolve(run.payerId),
        boughtOn: run.boughtOn,
        currency: run.currency,
        status: run.status,
        receiptId: run.receiptId,
        expenseId: run.expenseId,
        items: mine.map((i) => {
          const units = new Map<string, number>();
          for (const u of uses.filter((x) => x.itemId === i.id)) {
            const id = r.resolve(u.participantId);
            units.set(id, (units.get(id) ?? 0) + u.units);
          }
          return {
            id: i.id,
            name: i.name,
            amountCents: i.amountCents,
            uses: [...units].map(([participantId, n]) => ({ participantId, units: n })),
          };
        }),
        taxCents: run.taxCents,
        feeCents: run.feeCents,
        discountCents: run.discountCents,
        totalCents: itemsTotal + run.taxCents + run.feeCents - run.discountCents,
        createdById: run.createdBy ? r.resolve(run.createdBy) : null,
        createdAt: run.createdAt.toISOString(),
        settledAt: run.settledAt?.toISOString() ?? null,
      };
    });
  };

  const loadRun = async (groupId: string, runId: string) => {
    if (!isUuid(runId)) throw notFound("Pantry run not found");
    const [run] = await db
      .select()
      .from(schema.pantryRuns)
      .where(
        and(
          eq(schema.pantryRuns.id, runId),
          eq(schema.pantryRuns.groupId, groupId),
          isNull(schema.pantryRuns.deletedAt),
        ),
      )
      .limit(1);
    if (!run) throw notFound("Pantry run not found");
    return run;
  };

  const one = async (groupId: string, runId: string, r: ParticipantResolver) =>
    (await present([await loadRun(groupId, runId)], r))[0]!;

  /** Whoever stocked it, whoever paid, or the owner. */
  const requireManager = (m: Membership, run: RunRow, r: ParticipantResolver) => {
    const allowed = [run.createdBy, run.payerId].filter(Boolean).map((id) => r.resolve(id!));
    if (!allowed.includes(m.me.id) && m.me.role !== "owner")
      throw forbidden("Only whoever stocked or paid for it, or the owner, can do that");
  };

  router.get(
    "/groups/:id/pantry",
    describeRoute({
      tags: ["pantry"],
      summary: "Pantry runs, open ones first",
      responses: { 200: { description: "OK", content: json(PantryListResponseSchema) } },
    }),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const runs = await db
        .select()
        .from(schema.pantryRuns)
        .where(and(eq(schema.pantryRuns.groupId, m.group.id), isNull(schema.pantryRuns.deletedAt)))
        .orderBy(asc(schema.pantryRuns.status), desc(schema.pantryRuns.createdAt))
        .limit(50);
      return c.json({ runs: await present(runs, resolver) }, 200);
    },
  );

  router.post(
    "/groups/:id/pantry",
    describeRoute({
      tags: ["pantry"],
      summary: "Stock the pantry from a bulk shop",
      description:
        "Send items, or a scanned receipt's id to use its reviewed lines, tax, fees and discounts. People then mark what they used; settling posts one expense.",
      responses: { 201: { description: "Created", content: json(PantryRunSchema) } },
    }),
    validate("json", CreatePantryRunBodySchema),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const body = c.req.valid("json");

      let run: Omit<typeof schema.pantryRuns.$inferInsert, "groupId" | "currency" | "createdBy">;
      let items: { name: string; amountCents: number }[];
      if ("receiptId" in body) {
        const [receipt] = await db
          .select()
          .from(schema.receipts)
          .where(
            and(eq(schema.receipts.id, body.receiptId), eq(schema.receipts.groupId, m.group.id)),
          )
          .limit(1);
        if (!receipt) throw notFound("Receipt not found");
        if ((receipt.status !== "ready" && receipt.status !== "needs_review") || !receipt.ocr)
          throw conflict("That receipt has not been read yet");
        const ocr = ReceiptOcrSchema.parse(receipt.ocr);
        const payerId = body.payerId ?? receipt.uploadedBy;
        if (!payerId) throw badRequest("Say who paid");
        run = {
          receiptId: receipt.id,
          description: ocr.merchant ? `${ocr.merchant} run` : "Pantry run",
          payerId,
          boughtOn: ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date) ? ocr.date : todayUtc(),
          taxCents: Math.max(0, ocr.taxCents ?? 0),
          feeCents: Math.max(0, (ocr.feeCents ?? 0) + (ocr.tipCents ?? 0)),
          discountCents: Math.max(0, ocr.discountCents ?? 0),
        };
        items = ocr.items.map((i) => ({
          name: i.description.trim().slice(0, 120) || "Item",
          amountCents: Math.max(0, i.totalPriceCents),
        }));
        if (items.length === 0) throw conflict("That receipt has no items");
      } else {
        run = {
          description: body.description,
          payerId: body.payerId,
          boughtOn: body.boughtOn ?? todayUtc(),
          taxCents: body.taxCents,
          feeCents: body.feeCents,
          discountCents: body.discountCents,
        };
        items = body.items;
      }
      run.payerId = resolver.resolve(run.payerId);
      if (!resolver.active.has(run.payerId)) throw badRequest("Whoever paid must be in the group");

      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.pantryRuns)
          .values({ ...run, groupId: m.group.id, currency: m.group.currency, createdBy: m.me.id })
          .returning({ id: schema.pantryRuns.id });
        await tx
          .insert(schema.pantryItems)
          .values(items.map((item, position) => ({ runId: row!.id, position, ...item })));
        return row!.id;
      });
      return c.json(await one(m.group.id, id, resolver), 201);
    },
  );

  router.put(
    "/groups/:id/pantry/:runId/items/:itemId/uses/:pid",
    describeRoute({
      tags: ["pantry"],
      summary: "Set how much of an item someone used (yourself, or anyone as owner)",
      description: "Units are counts such as 2 of the 6 cartons; 0 clears it.",
      responses: { 200: { description: "OK", content: json(PantryRunSchema) } },
    }),
    validate("json", SetPantryUseBodySchema),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const pid = c.req.param("pid");
      const itemId = c.req.param("itemId");
      if (!isUuid(pid) || !resolver.active.has(pid)) throw notFound("Participant not found");
      if (pid !== m.me.id && m.me.role !== "owner")
        throw forbidden("Mark what you used; the owner can mark for others");
      if (!isUuid(itemId)) throw notFound("Item not found");
      const run = await loadRun(m.group.id, c.req.param("runId"));
      const { units } = c.req.valid("json");

      await db.transaction(async (tx) => {
        // Lock the run so a use cannot slip in while it is being settled.
        const [locked] = await tx
          .select({ status: schema.pantryRuns.status })
          .from(schema.pantryRuns)
          .where(eq(schema.pantryRuns.id, run.id))
          .for("update");
        if (locked?.status !== "open") throw conflict("This pantry run is already settled");
        const [item] = await tx
          .select({ id: schema.pantryItems.id })
          .from(schema.pantryItems)
          .where(and(eq(schema.pantryItems.id, itemId), eq(schema.pantryItems.runId, run.id)));
        if (!item) throw notFound("Item not found");
        const key = and(
          eq(schema.pantryUses.itemId, itemId),
          eq(schema.pantryUses.participantId, pid),
        );
        if (units === 0) {
          await tx.delete(schema.pantryUses).where(key);
        } else {
          await tx
            .insert(schema.pantryUses)
            .values({ itemId, participantId: pid, units })
            .onConflictDoUpdate({
              target: [schema.pantryUses.itemId, schema.pantryUses.participantId],
              set: { units },
            });
        }
      });
      return c.json(await one(m.group.id, run.id, resolver), 200);
    },
  );

  router.post(
    "/groups/:id/pantry/:runId/settle",
    describeRoute({
      tags: ["pantry"],
      summary: "Post the run as one expense, split by what people used",
      description:
        "Items nobody marked are shared by everyone who used something from the run (or the whole group if nobody did). Whoever stocked or paid for it, or the owner, can settle.",
      responses: {
        200: { description: "Settled", content: json(PantryRunSchema) },
        409: { description: "Already settled" },
      },
    }),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const run = await loadRun(m.group.id, c.req.param("runId"));
      requireManager(m, run, resolver);

      const activityId = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.pantryRuns)
          .where(eq(schema.pantryRuns.id, run.id))
          .for("update");
        if (locked?.status !== "open") throw conflict("This pantry run is already settled");
        const items = await tx
          .select()
          .from(schema.pantryItems)
          .where(eq(schema.pantryItems.runId, run.id))
          .orderBy(asc(schema.pantryItems.position));
        const uses = await tx
          .select()
          .from(schema.pantryUses)
          .where(
            inArray(
              schema.pantryUses.itemId,
              items.map((i) => i.id),
            ),
          );
        const input = pantryExpenseInput(
          locked,
          items.map((i) => ({ ...i, uses: uses.filter((u) => u.itemId === i.id) })),
          [...resolver.active],
          (id) => resolver.resolve(id),
        );
        const [expense] = await tx
          .insert(schema.expenses)
          .values({ groupId: m.group.id, createdBy: m.me.id })
          .returning({ id: schema.expenses.id });
        const written = await writeVersion(tx, {
          expenseId: expense!.id,
          version: 1,
          body: input,
          currency: locked.currency,
          actorId: m.me.id,
          active: resolver.active,
        });
        await tx
          .update(schema.pantryRuns)
          .set({ status: "settled", expenseId: expense!.id, settledAt: new Date() })
          .where(eq(schema.pantryRuns.id, run.id));
        return recordActivity(tx, {
          groupId: m.group.id,
          actorParticipantId: m.me.id,
          subjectId: expense!.id,
          involved: written.involved,
          kind: "expense.added",
          data: written.facts,
        });
      });
      notifier.activityRecorded(activityId);
      return c.json(await one(m.group.id, run.id, resolver), 200);
    },
  );

  router.delete(
    "/groups/:id/pantry/:runId",
    describeRoute({
      tags: ["pantry"],
      summary: "Remove an open pantry run",
      responses: { 204: { description: "Removed" }, 409: { description: "Already settled" } },
    }),
    async (c) => {
      const { m, resolver } = await member(c.get("session")!.user.id, c.req.param("id"));
      const run = await loadRun(m.group.id, c.req.param("runId"));
      requireManager(m, run, resolver);
      const [removed] = await db
        .update(schema.pantryRuns)
        .set({ deletedAt: new Date() })
        .where(and(eq(schema.pantryRuns.id, run.id), eq(schema.pantryRuns.status, "open")))
        .returning({ id: schema.pantryRuns.id });
      if (!removed) throw conflict("A settled run is an expense now; delete that instead");
      return c.body(null, 204);
    },
  );

  return router;
}
