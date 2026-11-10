import { allocate } from "./allocate.js";
import { SplitError } from "./errors.js";
import { cents, sumCents, type Cents } from "./money.js";

/** Identifier of a participant; opaque to the engine. */
export type ParticipantId = string;

/** Split an amount evenly between participants, leftover minor units going to the first ones. */
export interface EqualSplit {
  kind: "equal";
  participantIds: ParticipantId[];
}

/** Give each participant an explicit amount; the amounts must add up to the amount being split. */
export interface ExactSplit {
  kind: "exact";
  amounts: Array<{ participantId: ParticipantId; amount: Cents }>;
}

/**
 * Split by percentage. Percentages may be fractional (e.g. `10` for "one bite" of a dish) and
 * must add up to 100 within `1e-6`.
 */
export interface PercentSplit {
  kind: "percent";
  percents: Array<{ participantId: ParticipantId; percent: number }>;
}

/** Split by integer share counts (2 shares for a couple, 1 for a single). */
export interface SharesSplit {
  kind: "shares";
  shares: Array<{ participantId: ParticipantId; shares: number }>;
}

/** Any of the supported ways to divide one amount between participants. */
export type Split = EqualSplit | ExactSplit | PercentSplit | SharesSplit;

/** Tolerance when checking that percentages add up to 100. */
export const PERCENT_TOLERANCE = 1e-6;

/**
 * Return the participant ids a split names, in order, after checking they are non-empty and
 * unique.
 *
 * @throws {SplitError} `EMPTY_PARTICIPANTS` when the split names nobody.
 * @throws {SplitError} `DUPLICATE_PARTICIPANT` when an id repeats.
 */
export function splitParticipants(split: Split): ParticipantId[] {
  let ids: ParticipantId[];
  switch (split.kind) {
    case "equal":
      ids = split.participantIds;
      break;
    case "exact":
      ids = split.amounts.map((a) => a.participantId);
      break;
    case "percent":
      ids = split.percents.map((p) => p.participantId);
      break;
    case "shares":
      ids = split.shares.map((s) => s.participantId);
      break;
  }
  return assertUniqueParticipants(ids);
}

/**
 * Check that a participant list is non-empty and free of duplicates.
 *
 * @returns The same list.
 * @throws {SplitError} `EMPTY_PARTICIPANTS` | `DUPLICATE_PARTICIPANT`
 */
export function assertUniqueParticipants(ids: readonly ParticipantId[]): ParticipantId[] {
  if (ids.length === 0) {
    throw new SplitError("EMPTY_PARTICIPANTS", "At least one participant is required");
  }
  const seen = new Set<ParticipantId>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new SplitError("DUPLICATE_PARTICIPANT", `Participant "${id}" appears more than once`);
    }
    seen.add(id);
  }
  return [...ids];
}

/**
 * Divide `amount` between the participants of `split`.
 *
 * Every kind except `exact` is reduced to weights and handed to {@link allocate}, so the
 * result always sums exactly to `amount` and leftover minor units follow the largest-remainder
 * rule. The returned record has one key per participant named by the split (including zero
 * shares), in the split's order.
 *
 * @throws {SplitError} `INVALID_CENTS` when `amount` or an exact amount is not a safe integer.
 * @throws {SplitError} `EMPTY_PARTICIPANTS` | `DUPLICATE_PARTICIPANT` for a bad participant list.
 * @throws {SplitError} `EXACT_SUM_MISMATCH` when exact amounts do not add up to `amount`.
 * @throws {SplitError} `INVALID_PERCENT` | `PERCENT_SUM_MISMATCH` for bad percentages.
 * @throws {SplitError} `INVALID_SHARES` when a share count is not a non-negative integer.
 * @throws {SplitError} `ZERO_WEIGHTS` when every share is zero but `amount` is not.
 *
 * @example
 * ```ts
 * splitAmount(cents(10000), { kind: "equal", participantIds: ["a", "b", "c"] });
 * // { a: 3334, b: 3333, c: 3333 }
 * ```
 */
export function splitAmount(amount: Cents, split: Split): Record<ParticipantId, Cents> {
  const total = cents(amount);
  const ids = splitParticipants(split);
  const shares = sharesFor(total, split);
  return Object.fromEntries(ids.map((id, i) => [id, shares[i]])) as Record<ParticipantId, Cents>;
}

function sharesFor(total: Cents, split: Split): Cents[] {
  switch (split.kind) {
    case "equal":
      return allocate(
        total,
        split.participantIds.map(() => 1),
      );
    case "exact": {
      const amounts = split.amounts.map((a) => cents(a.amount));
      const sum = sumCents(amounts);
      if (sum !== total) {
        throw new SplitError(
          "EXACT_SUM_MISMATCH",
          `Exact amounts sum to ${sum} but ${total} is being split`,
        );
      }
      return amounts;
    }
    case "percent": {
      const percents = split.percents.map((p) => p.percent);
      let sum = 0;
      for (const [i, p] of percents.entries()) {
        if (!Number.isFinite(p) || p < 0) {
          throw new SplitError(
            "INVALID_PERCENT",
            `Percent at index ${i} must be a finite non-negative number, got ${p}`,
          );
        }
        sum += p;
      }
      if (Math.abs(sum - 100) > PERCENT_TOLERANCE) {
        throw new SplitError("PERCENT_SUM_MISMATCH", `Percents sum to ${sum}, expected 100`);
      }
      return allocate(total, percents);
    }
    case "shares": {
      const counts = split.shares.map((s) => s.shares);
      for (const [i, n] of counts.entries()) {
        if (!Number.isSafeInteger(n) || n < 0) {
          throw new SplitError(
            "INVALID_SHARES",
            `Shares at index ${i} must be a non-negative integer, got ${n}`,
          );
        }
      }
      return allocate(total, counts);
    }
  }
}
