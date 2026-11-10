import { SplitError } from "./errors.js";
import { cents, negCents, type Cents } from "./money.js";

/**
 * Validate a list of allocation weights: every weight must be a finite, non-negative number.
 *
 * @returns The sum of the weights.
 * @throws {SplitError} `INVALID_WEIGHT` for a negative, NaN or infinite weight.
 */
export function validateWeights(weights: readonly number[]): number {
  let total = 0;
  for (const [i, w] of weights.entries()) {
    if (!Number.isFinite(w) || w < 0) {
      throw new SplitError(
        "INVALID_WEIGHT",
        `Weight at index ${i} must be a finite non-negative number, got ${w}`,
      );
    }
    total += w;
  }
  return total;
}

/**
 * Allocate `total` across `weights` proportionally using largest-remainder rounding.
 *
 * Guarantees (see ADR 0001):
 * - the result has one entry per weight and sums exactly to `total`;
 * - each share is the floor or the ceiling of its exact proportional share
 *   `total * weight / sum(weights)`;
 * - the leftover minor units after flooring go to the shares with the largest fractional
 *   remainders, ties broken by lower index, so the result is fully deterministic;
 * - a zero weight always receives zero;
 * - negative totals are allocated as the negation of allocating `-total`.
 *
 * Weights may be fractional (percentages, 0.1 for "one bite"), they need not sum to anything
 * in particular, and an empty weight list allocates a zero total to `[]`.
 *
 * @throws {SplitError} `INVALID_CENTS` when `total` is not a safe integer.
 * @throws {SplitError} `INVALID_WEIGHT` for a negative, NaN or infinite weight.
 * @throws {SplitError} `ZERO_WEIGHTS` when every weight is zero (or there are none) but
 *   `total` is not zero, because there is nobody to give the money to.
 *
 * @example
 * ```ts
 * allocate(cents(10000), [1, 1, 1]); // [3334, 3333, 3333]
 * allocate(cents(100), [0.1, 0.9]); // [10, 90]
 * ```
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  const amount = cents(total);
  const weightSum = validateWeights(weights);

  if (weightSum === 0) {
    if (amount !== 0) {
      throw new SplitError("ZERO_WEIGHTS", `Cannot allocate ${amount} across all-zero weights`);
    }
    return weights.map(() => cents(0));
  }

  if (amount < 0) {
    return allocate(negCents(amount), weights).map((share) => negCents(share));
  }

  const floors: number[] = new Array<number>(weights.length);
  const fractions: number[] = new Array<number>(weights.length);
  let allocated = 0;
  for (const [i, w] of weights.entries()) {
    const exact = (amount * w) / weightSum;
    const floor = Math.floor(exact);
    floors[i] = floor;
    fractions[i] = exact - floor;
    allocated += floor;
  }

  // Hand the leftover minor units to the largest fractional remainders, lowest index first.
  const remainder = amount - allocated;
  const order = weights.map((_, i) => i);
  order.sort((a, b) => {
    const byFraction = (fractions[b] ?? 0) - (fractions[a] ?? 0);
    return byFraction !== 0 ? byFraction : a - b;
  });
  for (const i of order.slice(0, remainder)) {
    floors[i] = (floors[i] ?? 0) + 1;
  }

  return floors.map((share) => cents(share));
}
