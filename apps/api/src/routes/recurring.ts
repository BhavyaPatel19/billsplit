import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver as zodResolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  CreateRecurringBodySchema,
  RecurringExpenseSchema,
  RecurringListResponseSchema,
  UpdateRecurringBodySchema,
  type RecurringExpense,
  type RecurringTemplate,
} from "@billsplit/contracts";
import { requireMembership, type Membership } from "../lib/authorize.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { compute, ParticipantResolver } from "../lib/ledger.js";
import { validate } from "../lib/validate.js";
import {
  addDays,
  firstOccurrenceOnOrAfter,
  occurrenceDate,
  todayUtc,
  type IsoDate,
} from "../lib/schedule.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";
import { cadenceOf, resolveTemplate, type RecurringPoster } from "../recurring.js";

type Row = typeof schema.recurringExpenses.$inferSelect;

const json = (s: Parameters<typeof zodResolver>[0]) => ({
  "application/json": { schema: zodResolver(s) },
});

/** How far back a new schedule may start (so this month's rent can still be posted). */
const MAX_BACKDATE_DAYS = 31;

const isEnded = (s: Row) => s.endOn !== null && s.nextOn > s.endOn;

export function recurringRoutes(db: Db, poster: RecurringPoster) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/recurring", requireSession);
  router.use("/groups/:id/recurring/*", requireSession);

  const now = () => new Date();
  const today = (): IsoDate => todayUtc(now());

  const toApi = (s: Row, currency: string, r: ParticipantResolver, posted: number) => {
    const expense = resolveTemplate(s.template as RecurringTemplate, r);
    const { breakdown } = compute({ ...expense, spentOn: s.startOn }, currency);
    const ended = isEnded(s);
    const out: RecurringExpense = {
      id: s.id,
      description: expense.description,
      currency,
      totalCents: breakdown.total,
      expense,
      frequency: s.frequency,
      interval: s.interval,
      startOn: s.startOn,
      endOn: s.endOn,
      nextOn: ended ? null : s.nextOn,
      status: ended ? "ended" : s.pausedAt ? "paused" : "active",
      pausedReason: s.pausedReason,
      postedCount: posted,
      createdById: s.createdBy ? r.resolve(s.createdBy) : null,
      createdAt: s.createdAt.toISOString(),
    };
    return out;
  };

  const postedCounts = async (ids: string[]) => {
    if (ids.length === 0) return new Map<string, number>();
    const rows = await db
      .select({ id: schema.expenses.recurringExpenseId, n: count() })
      .from(schema.expenses)
      .where(inArray(schema.expenses.recurringExpenseId, ids))
      .groupBy(schema.expenses.recurringExpenseId);
    return new Map(rows.map((row) => [row.id!, row.n]));
  };

  const load = async (groupId: string, id: string) => {
    if (!isUuid(id)) throw notFound("Recurring expense not found");
    const [row] = await db
      .select()
      .from(schema.recurringExpenses)
      .where(
        and(
          eq(schema.recurringExpenses.id, id),
          eq(schema.recurringExpenses.groupId, groupId),
          isNull(schema.recurringExpenses.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw notFound("Recurring expense not found");
    return row;
  };

  const respond = async ({ group }: Membership, id: string) => {
    const [row, resolver, counts] = await Promise.all([
      load(group.id, id),
      ParticipantResolver.forGroup(db, group.id),
      postedCounts([id]),
    ]);
    return toApi(row, group.currency, resolver, counts.get(id) ?? 0);
  };

  /** Whoever set it up, or the group owner, may change it. */
  const requireManager = (m: Membership, row: Row, resolver: ParticipantResolver) => {
    const creator = row.createdBy ? resolver.resolve(row.createdBy) : null;
    if (creator !== m.me.id && m.me.role !== "owner")
      throw forbidden("Only whoever set it up, or the group owner, can change it");
  };

  router.get(
    "/groups/:id/recurring",
    describeRoute({
      tags: ["recurring"],
      summary: "Recurring expenses in a group",
      responses: { 200: { description: "OK", content: json(RecurringListResponseSchema) } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const [rows, resolver] = await Promise.all([
        db
          .select()
          .from(schema.recurringExpenses)
          .where(
            and(
              eq(schema.recurringExpenses.groupId, group.id),
              isNull(schema.recurringExpenses.deletedAt),
            ),
          )
          .orderBy(desc(schema.recurringExpenses.createdAt))
          .limit(200),
        ParticipantResolver.forGroup(db, group.id),
      ]);
      const counts = await postedCounts(rows.map((r) => r.id));
      return c.json(
        {
          recurring: rows.map((r) => toApi(r, group.currency, resolver, counts.get(r.id) ?? 0)),
        },
        200,
      );
    },
  );

  router.post(
    "/groups/:id/recurring",
    describeRoute({
      tags: ["recurring"],
      summary: "Set up a recurring expense",
      description:
        "Posts the expense every N weeks or months, starting on `startOn`. Monthly bills keep their day of the month and use the last day in shorter months. Occurrences already due (a start up to 31 days back) are posted right away.",
      responses: {
        201: { description: "Created", content: json(RecurringExpenseSchema) },
        400: { description: "Invalid split or dates" },
      },
    }),
    validate("json", CreateRecurringBodySchema),
    async (c) => {
      const membership = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const { group, me } = membership;
      const body = c.req.valid("json");
      if (body.startOn < addDays(today(), -MAX_BACKDATE_DAYS))
        throw badRequest(`The first date can be at most ${MAX_BACKDATE_DAYS} days ago`);
      const resolver = await ParticipantResolver.forGroup(db, group.id);
      compute({ ...body.expense, spentOn: body.startOn }, group.currency, resolver.active);

      const [row] = await db
        .insert(schema.recurringExpenses)
        .values({
          groupId: group.id,
          createdBy: me.id,
          template: body.expense,
          frequency: body.frequency,
          interval: body.interval,
          startOn: body.startOn,
          endOn: body.endOn ?? null,
          nextOccurrence: 0,
          nextOn: body.startOn,
        })
        .returning({ id: schema.recurringExpenses.id });
      await poster.postDue(today(), row!.id);
      return c.json(await respond(membership, row!.id), 201);
    },
  );

  router.get(
    "/groups/:id/recurring/:recurringId",
    describeRoute({
      tags: ["recurring"],
      summary: "One recurring expense",
      responses: {
        200: { description: "OK", content: json(RecurringExpenseSchema) },
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const membership = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      return c.json(await respond(membership, c.req.param("recurringId")), 200);
    },
  );

  router.patch(
    "/groups/:id/recurring/:recurringId",
    describeRoute({
      tags: ["recurring"],
      summary: "Pause, resume or edit a recurring expense",
      description:
        "Resuming continues from today: occurrences that fell while it was paused are not posted. A new template only changes future postings.",
      responses: { 200: { description: "OK", content: json(RecurringExpenseSchema) } },
    }),
    validate("json", UpdateRecurringBodySchema),
    async (c) => {
      const membership = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const { group } = membership;
      const body = c.req.valid("json");
      const id = c.req.param("recurringId");
      const resolver = await ParticipantResolver.forGroup(db, group.id);
      requireManager(membership, await load(group.id, id), resolver);
      if (body.expense)
        compute({ ...body.expense, spentOn: today() }, group.currency, resolver.active);

      await db.transaction(async (tx) => {
        const r = schema.recurringExpenses;
        // Lock it so a concurrent posting sees either the old or the new state, never a mix.
        const [row] = await tx
          .select()
          .from(r)
          .where(and(eq(r.id, id), isNull(r.deletedAt)))
          .for("update");
        if (!row) throw notFound("Recurring expense not found");
        const endOn = body.endOn === undefined ? row.endOn : body.endOn;
        if (endOn !== null && endOn < row.startOn)
          throw badRequest("End date must be on or after the start date");

        const changes: Partial<typeof r.$inferInsert> = { endOn };
        if (body.expense) changes.template = body.expense;
        if (body.paused === true && !row.pausedAt) changes.pausedAt = now();
        if (body.paused === false && row.pausedAt) {
          const next = Math.max(
            row.nextOccurrence,
            firstOccurrenceOnOrAfter(cadenceOf(row), today()),
          );
          Object.assign(changes, {
            pausedAt: null,
            pausedReason: null,
            nextOccurrence: next,
            nextOn: occurrenceDate(cadenceOf(row), next),
          });
        }
        await tx.update(r).set(changes).where(eq(r.id, id));
      });
      if (body.paused === false) await poster.postDue(today(), id);
      return c.json(await respond(membership, id), 200);
    },
  );

  router.post(
    "/groups/:id/recurring/:recurringId/skip",
    describeRoute({
      tags: ["recurring"],
      summary: "Skip the next posting",
      description: "Moves the schedule on by one occurrence without posting it.",
      responses: {
        200: { description: "OK", content: json(RecurringExpenseSchema) },
        409: { description: "The schedule has ended" },
      },
    }),
    async (c) => {
      const membership = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const id = c.req.param("recurringId");
      const resolver = await ParticipantResolver.forGroup(db, membership.group.id);
      requireManager(membership, await load(membership.group.id, id), resolver);
      await db.transaction(async (tx) => {
        const r = schema.recurringExpenses;
        const [row] = await tx
          .select()
          .from(r)
          .where(and(eq(r.id, id), isNull(r.deletedAt)))
          .for("update");
        if (!row) throw notFound("Recurring expense not found");
        if (isEnded(row)) throw conflict("This recurring expense has ended");
        await tx
          .update(r)
          .set({
            nextOccurrence: row.nextOccurrence + 1,
            nextOn: occurrenceDate(cadenceOf(row), row.nextOccurrence + 1),
          })
          .where(eq(r.id, id));
      });
      return c.json(await respond(membership, id), 200);
    },
  );

  router.delete(
    "/groups/:id/recurring/:recurringId",
    describeRoute({
      tags: ["recurring"],
      summary: "Stop a recurring expense",
      description: "Expenses it already posted stay in the group.",
      responses: { 204: { description: "Stopped" } },
    }),
    async (c) => {
      const membership = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const id = c.req.param("recurringId");
      const resolver = await ParticipantResolver.forGroup(db, membership.group.id);
      requireManager(membership, await load(membership.group.id, id), resolver);
      await db
        .update(schema.recurringExpenses)
        .set({ deletedAt: now() })
        .where(
          and(eq(schema.recurringExpenses.id, id), isNull(schema.recurringExpenses.deletedAt)),
        );
      return c.body(null, 204);
    },
  );

  return router;
}
