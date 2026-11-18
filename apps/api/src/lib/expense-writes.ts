import { eq } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import type { ExpenseInput } from "@billsplit/contracts";
import { compute } from "./ledger.js";
import { todayUtc } from "./schedule.js";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Insert a version (1 for a new expense) with its shares and make it current. Used by the
 * expense routes and the recurring poster, so both go through the same split engine checks.
 *
 * @throws ApiError 400 when the input does not compute or names someone not in `active`.
 */
export async function writeVersion(
  tx: Tx,
  args: {
    expenseId: string;
    version: number;
    body: ExpenseInput;
    currency: string;
    actorId: string | null;
    active: ReadonlySet<string>;
  },
) {
  const stored: ExpenseInput = { ...args.body, spentOn: args.body.spentOn ?? todayUtc() };
  const { breakdown, shares } = compute(stored, args.currency, args.active);
  const [row] = await tx
    .insert(schema.expenseVersions)
    .values({
      expenseId: args.expenseId,
      version: args.version,
      description: stored.description,
      currency: args.currency,
      spentOn: stored.spentOn!,
      payerId: stored.payerId,
      totalCents: breakdown.total,
      input: stored,
      createdBy: args.actorId,
    })
    .returning({ id: schema.expenseVersions.id });
  await tx.insert(schema.expenseShares).values(shares.map((s) => ({ versionId: row!.id, ...s })));
  await tx
    .update(schema.expenses)
    .set({ currentVersionId: row!.id })
    .where(eq(schema.expenses.id, args.expenseId));
  return {
    facts: {
      description: stored.description,
      totalCents: breakdown.total,
      currency: args.currency,
      payerId: stored.payerId,
    },
    involved: [stored.payerId, ...shares.map((s) => s.participantId)],
  };
}
