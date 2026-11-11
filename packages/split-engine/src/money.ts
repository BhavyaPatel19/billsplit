import { SplitError } from "./errors.js";

declare const centsBrand: unique symbol;

/**
 * A money amount in a currency's minor unit (cents for USD, yen for JPY, fils for BHD).
 *
 * Always an integer within `Number.isSafeInteger`; may be negative (a debt or a discount).
 * The brand keeps arbitrary `number`s out of money arithmetic at compile time; use
 * {@link cents} to validate and brand a value at runtime.
 */
export type Cents = number & { readonly [centsBrand]: "Cents" };

/**
 * Validate that `n` is a safe integer and brand it as {@link Cents}.
 *
 * @throws {SplitError} `INVALID_CENTS` when `n` is fractional, NaN, infinite or beyond
 *   `Number.MAX_SAFE_INTEGER`.
 */
export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n)) {
    throw new SplitError(
      "INVALID_CENTS",
      `Expected a safe integer number of minor units, got ${n}`,
    );
  }
  // Normalise -0 (e.g. from negating a zero) so equality checks and JSON stay predictable.
  return (n === 0 ? 0 : n) as Cents;
}

/**
 * Add two amounts. The result is validated, so an overflow past the safe-integer range throws
 * instead of silently losing precision.
 *
 * @throws {SplitError} `INVALID_CENTS` on overflow.
 */
export function addCents(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

/**
 * Subtract `b` from `a`.
 *
 * @throws {SplitError} `INVALID_CENTS` on overflow.
 */
export function subCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

/**
 * Multiply an amount by an integer factor (e.g. a unit price by a quantity).
 *
 * @throws {SplitError} `INVALID_CENTS` when `factor` is not a safe integer or the product
 *   overflows.
 */
export function mulCents(a: Cents, factor: number): Cents {
  if (!Number.isSafeInteger(factor)) {
    throw new SplitError("INVALID_CENTS", `Expected an integer factor, got ${factor}`);
  }
  return cents(a * factor);
}

/**
 * Sum a list of amounts. The empty list sums to zero.
 *
 * @throws {SplitError} `INVALID_CENTS` on overflow.
 */
export function sumCents(amounts: Iterable<Cents>): Cents {
  let total = 0;
  for (const amount of amounts) {
    total += amount;
  }
  return cents(total);
}

/**
 * Negate an amount.
 */
export function negCents(a: Cents): Cents {
  return cents(0 - a);
}

const ZERO = 0 as Cents;

/** The zero amount, handy as a reducer seed. */
export const ZERO_CENTS: Cents = ZERO;

/**
 * Format an amount for display with `Intl.NumberFormat`.
 *
 * The number of minor-unit digits comes from Intl's knowledge of the currency
 * (`resolvedOptions().maximumFractionDigits`), so `formatCents(1234, "USD")` is `"$12.34"`
 * while `formatCents(1234, "JPY")` is `"¥1,234"` and `formatCents(1234, "BHD")` is
 * `"BHD 1.234"`. The amount is converted to a decimal *string* before formatting, so no float
 * arithmetic ever touches the value.
 *
 * @param amount  The amount in minor units.
 * @param currency ISO 4217 currency code, e.g. `"USD"`.
 * @param locale  BCP 47 locale tag; defaults to `"en-US"`.
 * @throws {SplitError} `INVALID_CENTS` when `amount` is not a safe integer.
 * @throws {RangeError} (from Intl) when `currency` or `locale` is not well-formed.
 */
export function formatCents(amount: Cents, currency: string, locale = "en-US"): string {
  const value = cents(amount);
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(toDecimalString(value, digits) as Intl.StringNumericLiteral);
}

/**
 * Render an integer amount as an exact decimal string with `digits` fractional places.
 *
 * `toDecimalString(1234, 2)` is `"12.34"`; `toDecimalString(-5, 2)` is `"-0.05"`;
 * `toDecimalString(1234, 0)` is `"1234"`. Useful when handing amounts to APIs that accept
 * decimal strings (databases, payment providers) without going through floats.
 *
 * @throws {SplitError} `INVALID_CENTS` when `amount` is not a safe integer or `digits` is not
 *   a non-negative integer.
 */
export function toDecimalString(amount: Cents, digits: number): string {
  const value = cents(amount);
  if (!Number.isInteger(digits) || digits < 0) {
    throw new SplitError("INVALID_CENTS", `Expected a non-negative digit count, got ${digits}`);
  }
  const sign = value < 0 ? "-" : "";
  const magnitude = String(Math.abs(value)).padStart(digits + 1, "0");
  if (digits === 0) {
    return `${sign}${magnitude}`;
  }
  const whole = magnitude.slice(0, -digits);
  const fraction = magnitude.slice(-digits);
  return `${sign}${whole}.${fraction}`;
}

/**
 * Number of minor-unit digits for a currency according to Intl (2 for USD, 0 for JPY, 3 for BHD).
 *
 * @throws {RangeError} (from Intl) when `currency` is not a well-formed code.
 */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * Parse a user-typed decimal amount ("12.5", "1,234.56", ".99") into minor units without going
 * through floats. Returns `null` for anything that is not a plain decimal with at most
 * `digits` fractional places, or that does not fit in a safe integer.
 *
 * @example
 * ```ts
 * parseDecimal("12.5", 2); // 1250
 * parseDecimal("12.345", 2); // null (too precise)
 * ```
 */
export function parseDecimal(input: string, digits: number): Cents | null {
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match) return null;
  const [, sign, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > digits) return null;
  const value = Number(whole || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  if (!Number.isSafeInteger(value)) return null;
  return cents(sign ? 0 - value : value);
}
