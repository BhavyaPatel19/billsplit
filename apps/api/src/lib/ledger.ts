import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import type {
  BalancesResponse,
  ExpenseDetail,
  ExpenseInput,
  ExpenseShare,
  ExpenseSummary,
  SplitInput,
} from "@billsplit/contracts";
import {
  cents,
  computeExpense,
  simplifyDebts,
  splitParticipants,
  SplitError,
  type Cents,
  type ExpenseBreakdown,
  type ExpenseInput as EngineInput,
  type Split,
} from "@billsplit/split-engine";
import { badRequest } from "./errors.js";

type ParticipantRow = typeof schema.participants.$inferSelect;
type VersionRow = typeof schema.expenseVersions.$inferSelect;
type ExpenseRow = typeof schema.expenses.$inferSelect;

/**
 * Maps every participant id ever used in a group (placeholders that were merged included) to
 * the id that represents that person today.
 */
export class ParticipantResolver {
  private readonly map = new Map<string, string>();
  readonly active = new Set<string>();

  constructor(rows: readonly ParticipantRow[]) {
    for (const p of rows) {
      this.map.set(p.id, p.mergedIntoId ?? p.id);
      if (!p.mergedIntoId) this.active.add(p.id);
    }
  }

  static async forGroup(db: Db, groupId: string): Promise<ParticipantResolver> {
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.groupId, groupId));
    return new ParticipantResolver(rows);
  }

  resolve(id: string): string {
    return this.map.get(id) ?? id;
  }

  /** Re-key a per-participant record by current identity, summing collapsed entries. */
  record(input: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, amount] of Object.entries(input)) {
      const key = this.resolve(id);
      out[key] = (out[key] ?? 0) + amount;
    }
    return out;
  }

  split(split: SplitInput): SplitInput {
    switch (split.kind) {
      case "equal":
        return {
          kind: "equal",
          participantIds: [...new Set(split.participantIds.map((id) => this.resolve(id)))],
        };
      case "exact":
        return { kind: "exact", amounts: merge(split.amounts, "amount", (id) => this.resolve(id)) };
      case "percent":
        return {
          kind: "percent",
          percents: merge(split.percents, "percent", (id) => this.resolve(id)),
        };
      case "shares":
        return { kind: "shares", shares: merge(split.shares, "shares", (id) => this.resolve(id)) };
    }
  }
}

function merge<K extends string, T extends { participantId: string } & Record<K, number>>(
  rows: readonly T[],
  key: K,
  resolve: (id: string) => string,
): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    const id = resolve(row.participantId);
    const prev = byId.get(id);
    byId.set(id, prev ? { ...prev, [key]: prev[key] + row[key] } : { ...row, participantId: id });
  }
  return [...byId.values()];
}

function toEngineSplit(split: SplitInput): Split {
  switch (split.kind) {
    case "equal":
      return { kind: "equal", participantIds: split.participantIds };
    case "exact":
      return {
        kind: "exact",
        amounts: split.amounts.map((a) => ({
          participantId: a.participantId,
          amount: cents(a.amount),
        })),
      };
    case "percent":
      return { kind: "percent", percents: split.percents };
    case "shares":
      return { kind: "shares", shares: split.shares };
  }
}

export interface Computed {
  engineInput: EngineInput;
  breakdown: ExpenseBreakdown;
  shares: ExpenseShare[];
}

/**
 * Run a request through the split engine. Every participant involved must be an active member
 * of the group (pass `active` when validating new input; omit it when replaying stored input).
 *
 * @throws ApiError 400 for unknown participants or input the engine rejects.
 */
export function compute(
  input: ExpenseInput,
  currency: string,
  active?: ReadonlySet<string>,
): Computed {
  const items = input.items.map((item, i) => ({
    id: String(i),
    name: item.name,
    amount: cents(item.amountCents),
    quantity: item.quantity,
    split: toEngineSplit(item.split),
  }));

  let involved: string[];
  try {
    involved = [...new Set([input.payerId, ...items.flatMap((it) => splitParticipants(it.split))])];
  } catch (err) {
    throw engineError(err);
  }
  if (active) {
    const unknown = involved.filter((id) => !active.has(id));
    if (unknown.length > 0)
      throw badRequest("Everyone in the split must be in the group", { unknown });
  }

  const engineInput: EngineInput = {
    currency,
    payerId: input.payerId,
    participants: involved,
    items,
    adjustments: input.adjustments.map((a) => ({
      kind: a.kind,
      amount: cents(a.amountCents),
      allocation: a.allocation,
    })),
  };

  let breakdown: ExpenseBreakdown;
  try {
    breakdown = computeExpense(engineInput);
  } catch (err) {
    throw engineError(err);
  }

  const shares = involved.map((participantId) => ({
    participantId,
    paidCents: participantId === input.payerId ? breakdown.total : 0,
    owedCents: breakdown.totals[participantId] ?? 0,
  }));
  return { engineInput, breakdown, shares };
}

function engineError(err: unknown): Error {
  if (err instanceof SplitError) return badRequest(err.message, { code: err.code });
  return err instanceof Error ? err : new Error(String(err));
}

function resolveShares(
  shares: readonly ExpenseShare[],
  resolver: ParticipantResolver,
): ExpenseShare[] {
  const byId = new Map<string, ExpenseShare>();
  for (const s of shares) {
    const id = resolver.resolve(s.participantId);
    const prev = byId.get(id);
    byId.set(id, {
      participantId: id,
      paidCents: (prev?.paidCents ?? 0) + s.paidCents,
      owedCents: (prev?.owedCents ?? 0) + s.owedCents,
    });
  }
  return [...byId.values()];
}

export function toSummary(
  expense: ExpenseRow,
  version: VersionRow,
  shares: readonly ExpenseShare[],
  resolver: ParticipantResolver,
): ExpenseSummary {
  return {
    id: expense.id,
    version: version.version,
    description: version.description,
    currency: version.currency,
    spentOn: version.spentOn,
    payerId: resolver.resolve(version.payerId),
    totalCents: version.totalCents,
    shares: resolveShares(shares, resolver),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: version.createdAt.toISOString(),
  };
}

export function toDetail(
  expense: ExpenseRow,
  version: VersionRow,
  shares: readonly ExpenseShare[],
  resolver: ParticipantResolver,
): ExpenseDetail {
  const input = version.input as ExpenseInput;
  const { breakdown } = compute(input, version.currency);
  return {
    ...toSummary(expense, version, shares, resolver),
    items: input.items.map((item, i) => ({
      ...item,
      split: resolver.split(item.split),
      totalCents: breakdown.items[i]?.total ?? 0,
      perParticipant: resolver.record(breakdown.items[i]?.perParticipant ?? {}),
    })),
    adjustments: input.adjustments.map((a, i) => ({
      ...a,
      perParticipant: resolver.record(breakdown.adjustments[i]?.perParticipant ?? {}),
    })),
  };
}

/** Load the current version and shares for a set of live expenses. */
export async function loadExpenses(db: Db, groupId: string, expenseId?: string) {
  const rows = await db
    .select({ expense: schema.expenses, version: schema.expenseVersions })
    .from(schema.expenses)
    .innerJoin(
      schema.expenseVersions,
      eq(schema.expenseVersions.id, schema.expenses.currentVersionId),
    )
    .where(
      and(
        eq(schema.expenses.groupId, groupId),
        isNull(schema.expenses.deletedAt),
        expenseId ? eq(schema.expenses.id, expenseId) : undefined,
      ),
    )
    .orderBy(sql`${schema.expenseVersions.spentOn} desc`, sql`${schema.expenses.createdAt} desc`)
    .limit(500);

  const versionIds = rows.map((r) => r.version.id);
  const shareRows = versionIds.length
    ? await db
        .select()
        .from(schema.expenseShares)
        .where(inArray(schema.expenseShares.versionId, versionIds))
    : [];
  const sharesByVersion = new Map<string, ExpenseShare[]>();
  for (const s of shareRows) {
    const list = sharesByVersion.get(s.versionId) ?? [];
    list.push({ participantId: s.participantId, paidCents: s.paidCents, owedCents: s.owedCents });
    sharesByVersion.set(s.versionId, list);
  }
  return rows.map((r) => ({ ...r, shares: sharesByVersion.get(r.version.id) ?? [] }));
}

/**
 * Net balance per active participant (expenses paid minus share owed, adjusted by recorded
 * payments) and the fewest transfers that settle the group.
 */
export async function groupBalances(
  db: Db,
  groupId: string,
  currency: string,
  resolver: ParticipantResolver,
): Promise<BalancesResponse> {
  const fromExpenses = await db
    .select({
      participantId: schema.expenseShares.participantId,
      net: sql<string>`sum(${schema.expenseShares.paidCents} - ${schema.expenseShares.owedCents})`,
    })
    .from(schema.expenseShares)
    .innerJoin(
      schema.expenses,
      eq(schema.expenses.currentVersionId, schema.expenseShares.versionId),
    )
    .where(and(eq(schema.expenses.groupId, groupId), isNull(schema.expenses.deletedAt)))
    .groupBy(schema.expenseShares.participantId);

  const payments = await db
    .select({
      fromId: schema.settlements.fromId,
      toId: schema.settlements.toId,
      amount: sql<string>`sum(${schema.settlements.amountCents})`,
    })
    .from(schema.settlements)
    .where(and(eq(schema.settlements.groupId, groupId), isNull(schema.settlements.deletedAt)))
    .groupBy(schema.settlements.fromId, schema.settlements.toId);

  const net = new Map<string, number>([...resolver.active].map((id) => [id, 0]));
  const add = (id: string, amount: number) => {
    const key = resolver.resolve(id);
    net.set(key, (net.get(key) ?? 0) + amount);
  };
  for (const row of fromExpenses) add(row.participantId, Number(row.net));
  for (const row of payments) {
    // Paying off a debt raises the payer's balance and lowers the receiver's.
    add(row.fromId, Number(row.amount));
    add(row.toId, -Number(row.amount));
  }

  const balances = Object.fromEntries(net) as Record<string, Cents>;
  const transfers = simplifyDebts(balances).map((t) => ({
    fromId: t.from,
    toId: t.to,
    amountCents: t.amount,
  }));
  return {
    currency,
    balances: [...net].map(([participantId, netCents]) => ({ participantId, netCents })),
    transfers,
  };
}

/** True when a participant appears in any expense version or payment (so it cannot be deleted). */
export async function hasHistory(db: Db, participantId: string): Promise<boolean> {
  const [share] = await db
    .select({ id: schema.expenseShares.versionId })
    .from(schema.expenseShares)
    .where(eq(schema.expenseShares.participantId, participantId))
    .limit(1);
  if (share) return true;
  const [payment] = await db
    .select({ id: schema.settlements.id })
    .from(schema.settlements)
    .where(
      sql`${schema.settlements.fromId} = ${participantId} or ${schema.settlements.toId} = ${participantId}`,
    )
    .limit(1);
  if (payment) return true;
  const [payer] = await db
    .select({ id: schema.expenseVersions.id })
    .from(schema.expenseVersions)
    .where(eq(schema.expenseVersions.payerId, participantId))
    .limit(1);
  return Boolean(payer);
}

/** Postgres unique-violation on a specific constraint, wrapped or not by Drizzle. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const candidates = [err, (err as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      (e as { code?: string }).code === "23505" &&
      (e as { constraint?: string }).constraint === constraint,
  );
}
