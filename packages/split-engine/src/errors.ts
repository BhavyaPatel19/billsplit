/**
 * Machine-readable reasons a split-engine operation can reject its input.
 *
 * Every error thrown by this package is a {@link SplitError} carrying one of these codes so
 * callers can branch on `code` instead of parsing messages.
 */
export type SplitErrorCode =
  /** A money amount is not a safe integer number of minor units. */
  | "INVALID_CENTS"
  /** A weight is negative, NaN or infinite. */
  | "INVALID_WEIGHT"
  /** Every weight is zero but the amount to allocate is not. */
  | "ZERO_WEIGHTS"
  /** A split or expense names no participants or an empty participant list. */
  | "EMPTY_PARTICIPANTS"
  /** The same participant id appears more than once where ids must be unique. */
  | "DUPLICATE_PARTICIPANT"
  /** A participant referenced by an item or split is not part of the expense. */
  | "UNKNOWN_PARTICIPANT"
  /** `exact` split amounts do not add up to the amount being split. */
  | "EXACT_SUM_MISMATCH"
  /** `percent` split percentages do not add up to 100 (within 1e-6). */
  | "PERCENT_SUM_MISMATCH"
  /** A `shares` split contains a share count that is not a non-negative integer. */
  | "INVALID_SHARES"
  /** A percentage is negative, NaN or infinite. */
  | "INVALID_PERCENT"
  /** An item quantity is not a positive safe integer. */
  | "INVALID_QUANTITY"
  /** An item or adjustment amount that must be non-negative is negative. */
  | "NEGATIVE_AMOUNT"
  /** The same item id appears more than once in an expense. */
  | "DUPLICATE_ITEM"
  /** Net balances do not sum to zero, so no set of transfers can settle them. */
  | "UNBALANCED";

/**
 * Error thrown for every rejected input in `@billsplit/split-engine`.
 *
 * The engine never throws plain `Error`s or `RangeError`s for domain problems; it always
 * throws a `SplitError` whose {@link SplitError.code} identifies the rule that was violated.
 *
 * @example
 * ```ts
 * try {
 *   cents(1.5);
 * } catch (e) {
 *   if (e instanceof SplitError && e.code === "INVALID_CENTS") {
 *     // handle it
 *   }
 * }
 * ```
 */
export class SplitError extends Error {
  /** The rule that was violated. */
  readonly code: SplitErrorCode;

  constructor(code: SplitErrorCode, message: string) {
    super(message);
    this.name = "SplitError";
    this.code = code;
  }
}
