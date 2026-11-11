/**
 * `@billsplit/split-engine` — pure, I/O-free money math.
 *
 * All amounts are integers in a currency's minor unit ({@link Cents}); nothing here touches
 * floats except to turn fractional weights into integer shares, and every allocation sums
 * exactly to its input (ADR 0001).
 *
 * @packageDocumentation
 */
export { SplitError, type SplitErrorCode } from "./errors.js";
export {
  type Cents,
  cents,
  addCents,
  subCents,
  negCents,
  mulCents,
  sumCents,
  ZERO_CENTS,
  formatCents,
  toDecimalString,
  currencyDigits,
  parseDecimal,
} from "./money.js";
export { allocate, validateWeights } from "./allocate.js";
export {
  type ParticipantId,
  type Split,
  type EqualSplit,
  type ExactSplit,
  type PercentSplit,
  type SharesSplit,
  PERCENT_TOLERANCE,
  splitAmount,
  splitParticipants,
  assertUniqueParticipants,
} from "./split.js";
export {
  type ExpenseInput,
  type ExpenseItem,
  type ExpenseAdjustment,
  type AdjustmentKind,
  type AdjustmentAllocation,
  type ExpenseBreakdown,
  type ItemBreakdown,
  type AdjustmentBreakdown,
  computeExpense,
} from "./expense.js";
export {
  type LedgerEntry,
  type Transfer,
  toLedgerEntries,
  netBalances,
  simplifyDebts,
  applyTransfers,
} from "./ledger.js";
