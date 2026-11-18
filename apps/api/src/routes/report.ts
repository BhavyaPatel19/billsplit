import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver as zodResolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import { ReportQuerySchema, ReportSchema, type ReportQuery } from "@billsplit/contracts";
import { requireMembership } from "../lib/authorize.js";
import { groupBalances, loadExpenses, ParticipantResolver, toSummary } from "../lib/ledger.js";
import { buildReport, reportCsv } from "../lib/report.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

/** Enough for years of a household's bills; the report is not paginated. */
const MAX_EXPENSES = 10_000;

const inPeriod = (date: string, q: ReportQuery) =>
  (!q.from || date >= q.from) && (!q.to || date <= q.to);

export function reportRoutes(db: Db) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/report", requireSession);
  router.use("/groups/:id/report.csv", requireSession);

  const build = async (userId: string, groupId: string, q: ReportQuery) => {
    const { group } = await requireMembership(db, userId, groupId);
    const resolver = await ParticipantResolver.forGroup(db, group.id);
    const [rows, settlements, people, balances] = await Promise.all([
      loadExpenses(db, group.id, undefined, MAX_EXPENSES),
      db
        .select()
        .from(schema.settlements)
        .where(and(eq(schema.settlements.groupId, group.id), isNull(schema.settlements.deletedAt))),
      db
        .select({ id: schema.participants.id, name: schema.participants.displayName })
        .from(schema.participants)
        .where(
          and(eq(schema.participants.groupId, group.id), isNull(schema.participants.mergedIntoId)),
        ),
      groupBalances(db, group.id, group.currency, resolver),
    ]);
    return buildReport({
      groupName: group.name,
      currency: group.currency,
      from: q.from ?? null,
      to: q.to ?? null,
      people,
      expenses: rows
        .filter((r) => inPeriod(r.version.spentOn, q))
        .map((r) => toSummary(r.expense, r.version, r.shares, resolver)),
      payments: settlements
        .map((s) => ({
          id: s.id,
          on: s.createdAt.toISOString().slice(0, 10),
          fromId: resolver.resolve(s.fromId),
          toId: resolver.resolve(s.toId),
          amountCents: s.amountCents,
          note: s.note,
        }))
        .filter((p) => inPeriod(p.on, q)),
      balances,
    });
  };

  router.get(
    "/groups/:id/report",
    describeRoute({
      tags: ["report"],
      summary: "Move-out report: every expense and payment in a period, and final balances",
      responses: {
        200: {
          description: "OK",
          content: { "application/json": { schema: zodResolver(ReportSchema) } },
        },
      },
    }),
    validate("query", ReportQuerySchema),
    async (c) =>
      c.json(await build(c.get("session")!.user.id, c.req.param("id"), c.req.valid("query")), 200),
  );

  router.get(
    "/groups/:id/report.csv",
    describeRoute({
      tags: ["report"],
      summary: "The move-out report as CSV (opens in any spreadsheet)",
      responses: { 200: { description: "CSV", content: { "text/csv": {} } } },
    }),
    validate("query", ReportQuerySchema),
    async (c) => {
      const q = c.req.valid("query");
      const report = await build(c.get("session")!.user.id, c.req.param("id"), q);
      const slug =
        report.groupName
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase() || "group";
      const suffix = q.from || q.to ? `-${q.from ?? "start"}-to-${q.to ?? "today"}` : "";
      c.header("content-type", "text/csv; charset=utf-8");
      c.header("content-disposition", `attachment; filename="${slug}-report${suffix}.csv"`);
      c.header("cache-control", "no-store");
      // BOM so Excel reads UTF-8 names correctly.
      return c.body(`\uFEFF${reportCsv(report)}`, 200);
    },
  );

  return router;
}
