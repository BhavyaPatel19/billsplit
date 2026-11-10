import { SplitError } from "./errors.js";
import type { ExpenseBreakdown } from "./expense.js";
import { addCents, cents, negCents, subCents, ZERO_CENTS, type Cents } from "./money.js";
import type { ParticipantId } from "./split.js";

/** A directed IOU: `from` owes `to` `amount` minor units. `amount` is always positive. */
export interface LedgerEntry {
  from: ParticipantId;
  to: ParticipantId;
  amount: Cents;
}

/** A payment that settles part of a ledger; structurally the same as a {@link LedgerEntry}. */
export type Transfer = LedgerEntry;

/**
 * Turn a worked-out receipt into IOUs towards whoever paid it.
 *
 * Each non-payer owes `payerId` their total; the payer owes nobody. Zero totals are skipped.
 * If a participant's total is negative (a discount exceeded what they had) the direction flips
 * and the payer owes them, so every returned amount is positive. Entries follow the
 * participant order of the breakdown.
 *
 * @param breakdown Output of `computeExpense`.
 * @param payerId   Who paid; defaults to `breakdown.payerId`.
 * @throws {SplitError} `UNKNOWN_PARTICIPANT` when `payerId` is not in the breakdown.
 */
export function toLedgerEntries(
  breakdown: Pick<ExpenseBreakdown, "totals" | "payerId">,
  payerId: ParticipantId = breakdown.payerId,
): LedgerEntry[] {
  if (!Object.hasOwn(breakdown.totals, payerId)) {
    throw new SplitError("UNKNOWN_PARTICIPANT", `Payer "${payerId}" is not in the breakdown`);
  }
  const entries: LedgerEntry[] = [];
  for (const [pid, total] of Object.entries(breakdown.totals)) {
    if (pid === payerId || total === 0) continue;
    entries.push(
      total > 0
        ? { from: pid, to: payerId, amount: total }
        : { from: payerId, to: pid, amount: negCents(total) },
    );
  }
  return entries;
}

/**
 * Net a list of IOUs into one balance per participant.
 *
 * Positive means the participant is owed money, negative means they owe. Every participant
 * that appears in any entry gets a key (possibly zero), in first-seen order. The balances
 * always sum to zero.
 *
 * @throws {SplitError} `INVALID_CENTS` when an amount is not a safe integer or a balance overflows.
 */
export function netBalances(entries: readonly LedgerEntry[]): Record<ParticipantId, Cents> {
  const balances = new Map<ParticipantId, Cents>();
  for (const { from, to, amount } of entries) {
    const value = cents(amount);
    balances.set(from, subCents(balances.get(from) ?? ZERO_CENTS, value));
    balances.set(to, addCents(balances.get(to) ?? ZERO_CENTS, value));
  }
  return Object.fromEntries(balances);
}

/**
 * Settle a set of net balances with as few transfers as the greedy min-cash-flow algorithm
 * finds: repeatedly pay the largest debt to the largest credit.
 *
 * Guarantees:
 * - applying the transfers (`balance[from] += amount`, `balance[to] -= amount`) zeroes every
 *   balance;
 * - at most `participants - 1` transfers, because each transfer settles at least one party;
 * - deterministic: ties on amount are broken by participant id (`<` on strings), and the
 *   result is independent of key order in `balances`.
 *
 * @throws {SplitError} `INVALID_CENTS` when a balance is not a safe integer.
 * @throws {SplitError} `UNBALANCED` when the balances do not sum to zero.
 */
export function simplifyDebts(balances: Record<ParticipantId, Cents>): Transfer[] {
  const creditors: Array<{ id: ParticipantId; amount: number }> = [];
  const debtors: Array<{ id: ParticipantId; amount: number }> = [];
  let net = 0;
  for (const [id, raw] of Object.entries(balances)) {
    const balance = cents(raw);
    net += balance;
    if (balance > 0) creditors.push({ id, amount: balance });
    else if (balance < 0) debtors.push({ id, amount: 0 - balance });
  }
  if (net !== 0) {
    throw new SplitError("UNBALANCED", `Balances sum to ${net}, expected 0`);
  }

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDescThenId);
    debtors.sort(byAmountDescThenId);
    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({ from: debtor.id, to: creditor.id, amount: cents(amount) });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
  }
  return transfers;
}

/**
 * Apply transfers to balances and return the resulting balances. Mostly useful for checking
 * that a settlement plan really settles: `applyTransfers(b, simplifyDebts(b))` is all zeros.
 *
 * @throws {SplitError} `INVALID_CENTS` on overflow.
 */
export function applyTransfers(
  balances: Record<ParticipantId, Cents>,
  transfers: readonly Transfer[],
): Record<ParticipantId, Cents> {
  const result = new Map<ParticipantId, Cents>(
    Object.entries(balances).map(([id, b]) => [id, cents(b)]),
  );
  for (const { from, to, amount } of transfers) {
    result.set(from, addCents(result.get(from) ?? ZERO_CENTS, amount));
    result.set(to, subCents(result.get(to) ?? ZERO_CENTS, amount));
  }
  return Object.fromEntries(result);
}

function byAmountDescThenId(
  a: { id: ParticipantId; amount: number },
  b: { id: ParticipantId; amount: number },
): number {
  if (a.amount !== b.amount) return b.amount - a.amount;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
