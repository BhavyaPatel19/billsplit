import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addCents,
  cents,
  formatCents,
  mulCents,
  SplitError,
  subCents,
  sumCents,
  toDecimalString,
  ZERO_CENTS,
} from "../src/index.js";

const safeInt = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

describe("cents", () => {
  it("accepts safe integers including zero and negatives", () => {
    expect(cents(0)).toBe(0);
    expect(cents(-5)).toBe(-5);
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects %s", (n) => {
    expect(() => cents(n)).toThrow(SplitError);
    expect(() => cents(n)).toThrow(/safe integer/);
    try {
      cents(n);
    } catch (e) {
      expect((e as SplitError).code).toBe("INVALID_CENTS");
      expect((e as SplitError).name).toBe("SplitError");
    }
  });
});

describe("arithmetic", () => {
  it("adds, subtracts, multiplies and sums", () => {
    expect(addCents(cents(100), cents(23))).toBe(123);
    expect(subCents(cents(100), cents(123))).toBe(-23);
    expect(mulCents(cents(250), 4)).toBe(1000);
    expect(sumCents([cents(1), cents(2), cents(3)])).toBe(6);
    expect(sumCents([])).toBe(0);
    expect(ZERO_CENTS).toBe(0);
  });

  it("throws on overflow instead of losing precision", () => {
    const big = cents(Number.MAX_SAFE_INTEGER);
    expect(() => addCents(big, cents(1))).toThrow(SplitError);
    expect(() => subCents(cents(-Number.MAX_SAFE_INTEGER), cents(2))).toThrow(SplitError);
    expect(() => mulCents(big, 2)).toThrow(SplitError);
    expect(() => sumCents([big, cents(1)])).toThrow(SplitError);
  });

  it("rejects a non-integer multiplication factor", () => {
    expect(() => mulCents(cents(100), 1.5)).toThrow(SplitError);
  });

  it("is consistent with plain integer arithmetic", () => {
    fc.assert(
      fc.property(safeInt, safeInt, (a, b) => {
        expect(addCents(cents(a), cents(b))).toBe(a + b);
        expect(subCents(cents(a), cents(b))).toBe(a - b);
      }),
    );
  });
});

describe("toDecimalString", () => {
  it.each([
    [1234, 2, "12.34"],
    [5, 2, "0.05"],
    [-5, 2, "-0.05"],
    [0, 2, "0.00"],
    [1234, 0, "1234"],
    [-1234, 0, "-1234"],
    [1234, 3, "1.234"],
    [7, 3, "0.007"],
  ])("renders %i with %i digits as %s", (amount, digits, expected) => {
    expect(toDecimalString(cents(amount), digits)).toBe(expected);
  });

  it("rejects a bad digit count", () => {
    expect(() => toDecimalString(cents(1), -1)).toThrow(SplitError);
    expect(() => toDecimalString(cents(1), 1.5)).toThrow(SplitError);
  });

  it("round-trips through Number for two digits", () => {
    fc.assert(
      fc.property(safeInt, (n) => {
        expect(Math.round(Number(toDecimalString(cents(n), 2)) * 100)).toBe(n);
      }),
    );
  });
});

describe("formatCents", () => {
  it("uses the currency's minor unit digits", () => {
    expect(formatCents(cents(1234), "USD")).toBe("$12.34");
    expect(formatCents(cents(-1234), "USD")).toBe("-$12.34");
    expect(formatCents(cents(1234), "JPY")).toBe("¥1,234");
    expect(formatCents(cents(1234), "BHD").replace(/\u00a0/g, " ")).toBe("BHD 1.234");
  });

  it("honours the locale", () => {
    expect(formatCents(cents(123456), "EUR", "de-DE").replace(/\u00a0/g, " ")).toBe("1.234,56 €");
  });

  it("rejects fractional input", () => {
    expect(() => formatCents(1.5 as never, "USD")).toThrow(SplitError);
  });
});
