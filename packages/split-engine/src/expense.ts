import { allocate } from "./allocate.js";
import { SplitError } from "./errors.js";
import { addCents, cents, mulCents, negCents, sumCents, ZERO_CENTS, type Cents } from "./money.js";
import {
  assertUniqueParticipants,
  splitAmount,
  splitParticipants,
  type ParticipantId,
  type Split,
} from "./split.js";

/** One line on a receipt. */
export interface ExpenseItem {
  /** Caller-chosen id, unique within the expense. */
  id: string;
  /** Display name, carried through untouched. */
  name: string;
  /** Unit price in minor units; must be non-negative. */
  amount: Cents;
  /** How many units; a positive integer, defaults to `1`. The line total is `amount * quantity`. */
  quantity?: number;
  /** Who had this item and in what proportion. */
  split: Split;
}

/** The kind of a receipt-level adjustment. Discounts reduce the bill; the others increase it. */
export type AdjustmentKind = "tax" | "tip" | "discount" | "fee";

/**
 * How a receipt-level adjustment is spread across participants.
 *
 * - `proportional`: by each participant's item subtotal (everyone pays tax on what they ate).
 *   Falls back to `equal` when every subtotal is zero.
 * - `equal`: evenly over every participant of the expense.
 * - `payer`: entirely to the payer (e.g. a delivery fee the payer chose to absorb).
 */
export type AdjustmentAllocation = "proportional" | "equal" | "payer";

/** A receipt-level amount that is not tied to a single item. */
export interface ExpenseAdjustment {
  kind: AdjustmentKind;
  /**
   * Non-negative magnitude in minor units. For `discount` this is the amount *taken off* the
   * bill; the engine applies the sign.
   */
  amount: Cents;
  allocation: AdjustmentAllocation;
}

/** Everything needed to work out who owes what for one receipt. */
export interface ExpenseInput {
  /** ISO 4217 code; carried through for formatting, not used in arithmetic. */
  currency: string;
  /** Who paid the merchant. Must be one of `participants`. */
  payerId: ParticipantId;
  items: ExpenseItem[];
  adjustments: ExpenseAdjustment[];
  /** Everyone involved, including the payer. Order is preserved in every output record. */
  participants: ParticipantId[];
}

/** One item's contribution to the breakdown. */
export interface ItemBreakdown {
  id: string;
  /** `amount * quantity`. */
  total: Cents;
  /** The item's participants and their share of `total`. */
  perParticipant: Record<ParticipantId, Cents>;
}

/** One adjustment's contribution to the breakdown. */
export interface AdjustmentBreakdown {
  kind: AdjustmentKind;
  /** The input magnitude, unchanged. */
  amount: Cents;
  /**
   * Signed share per participant (one key per participant of the expense). Negative for
   * discounts, so `totals[p] = itemSubtotals[p] + sum over adjustments of perParticipant[p]`.
   */
  perParticipant: Record<ParticipantId, Cents>;
}

/** The fully worked-out receipt. */
export interface ExpenseBreakdown {
  currency: string;
  payerId: ParticipantId;
  items: ItemBreakdown[];
  /** Sum of each participant's item shares before adjustments; one key per participant. */
  itemSubtotals: Record<ParticipantId, Cents>;
  adjustments: AdjustmentBreakdown[];
  /** What each participant's share of the receipt comes to; one key per participant. */
  totals: Record<ParticipantId, Cents>;
  /**
   * Grand total of the receipt. Invariant:
   * `total == sum(totals) == sum(items) + sum(tax, tip, fee) - sum(discount)`.
   */
  total: Cents;
}

/**
 * Work out an itemised receipt: who had what, how tax, tip, fees and discounts spread, and what
 * each participant's share comes to.
 *
 * Every allocation goes through {@link allocate}, so shares are exact minor units and the
 * invariant `sum(totals) == sum(items) + sum(tax, tip, fee) - sum(discount)` always holds.
 * Participants who had nothing still appear in every record with a zero share. Totals can be
 * negative if a discount exceeds what somebody had.
 *
 * @throws {SplitError} `EMPTY_PARTICIPANTS` | `DUPLICATE_PARTICIPANT` for a bad participant list.
 * @throws {SplitError} `UNKNOWN_PARTICIPANT` when the payer or an item's participant is not in
 *   `participants`.
 * @throws {SplitError} `DUPLICATE_ITEM` when two items share an id.
 * @throws {SplitError} `NEGATIVE_AMOUNT` when an item or adjustment amount is negative.
 * @throws {SplitError} `INVALID_QUANTITY` when a quantity is not a positive safe integer.
 * @throws {SplitError} Anything {@link splitAmount} throws for a bad item split.
 */
export function computeExpense(input: ExpenseInput): ExpenseBreakdown {
  const participants = assertUniqueParticipants(input.participants);
  const known = new Set(participants);
  if (!known.has(input.payerId)) {
    throw new SplitError("UNKNOWN_PARTICIPANT", `Payer "${input.payerId}" is not a participant`);
  }

  const subtotals = new Map<ParticipantId, Cents>(participants.map((p) => [p, ZERO_CENTS]));
  const seenItems = new Set<string>();
  const items: ItemBreakdown[] = [];
  for (const item of input.items) {
    if (seenItems.has(item.id)) {
      throw new SplitError("DUPLICATE_ITEM", `Item "${item.id}" appears more than once`);
    }
    seenItems.add(item.id);
    const total = lineTotal(item);
    for (const pid of splitParticipants(item.split)) {
      if (!known.has(pid)) {
        throw new SplitError(
          "UNKNOWN_PARTICIPANT",
          `Item "${item.id}" names "${pid}", who is not a participant`,
        );
      }
    }
    const perParticipant = splitAmount(total, item.split);
    for (const [pid, share] of Object.entries(perParticipant)) {
      subtotals.set(pid, addCents(subtotals.get(pid) ?? ZERO_CENTS, share));
    }
    items.push({ id: item.id, total, perParticipant });
  }

  const totals = new Map(subtotals);
  const adjustments: AdjustmentBreakdown[] = [];
  for (const adjustment of input.adjustments) {
    const magnitude = cents(adjustment.amount);
    if (magnitude < 0) {
      throw new SplitError(
        "NEGATIVE_AMOUNT",
        `Adjustment amount must be non-negative, got ${magnitude}; use kind "discount" to reduce the bill`,
      );
    }
    const signed = adjustment.kind === "discount" ? negCents(magnitude) : magnitude;
    const weights = adjustmentWeights(
      adjustment.allocation,
      participants,
      input.payerId,
      subtotals,
    );
    const shares = allocate(signed, weights);
    const perParticipant: Record<ParticipantId, Cents> = {};
    for (const [i, pid] of participants.entries()) {
      const share = shares[i] ?? ZERO_CENTS;
      perParticipant[pid] = share;
      totals.set(pid, addCents(totals.get(pid) ?? ZERO_CENTS, share));
    }
    adjustments.push({ kind: adjustment.kind, amount: magnitude, perParticipant });
  }

  return {
    currency: input.currency,
    payerId: input.payerId,
    items,
    itemSubtotals: Object.fromEntries(subtotals),
    adjustments,
    totals: Object.fromEntries(totals),
    total: sumCents(totals.values()),
  };
}

function lineTotal(item: ExpenseItem): Cents {
  const unit = cents(item.amount);
  if (unit < 0) {
    throw new SplitError("NEGATIVE_AMOUNT", `Item "${item.id}" has a negative amount ${unit}`);
  }
  const quantity = item.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new SplitError(
      "INVALID_QUANTITY",
      `Item "${item.id}" quantity must be a positive integer, got ${quantity}`,
    );
  }
  return mulCents(unit, quantity);
}

function adjustmentWeights(
  allocation: AdjustmentAllocation,
  participants: readonly ParticipantId[],
  payerId: ParticipantId,
  subtotals: ReadonlyMap<ParticipantId, Cents>,
): number[] {
  switch (allocation) {
    case "payer":
      return participants.map((p) => (p === payerId ? 1 : 0));
    case "equal":
      return participants.map(() => 1);
    case "proportional": {
      const weights = participants.map((p) => subtotals.get(p) ?? 0);
      return weights.some((w) => w !== 0) ? weights : participants.map(() => 1);
    }
  }
}
