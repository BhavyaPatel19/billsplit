import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cents, currencyDigits, parseDecimal, toDecimalString } from "../src/index.js";

describe("currencyDigits", () => {
  it("knows minor units per currency", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("BHD")).toBe(3);
    expect(currencyDigits("INR")).toBe(2);
  });
});

describe("parseDecimal", () => {
  it.each<[string, number, number | null]>([
    ["12.34", 2, 1234],
    ["12.5", 2, 1250],
    ["12", 2, 1200],
    ["12.", 2, 1200],
    [".99", 2, 99],
    ["0", 2, 0],
    [" 1,234.56 ", 2, 123456],
    ["-5.25", 2, -525],
    ["1234", 0, 1234],
    ["1.234", 3, 1234],
    ["12.345", 2, null],
    ["1.5", 0, null],
    ["", 2, null],
    [".", 2, null],
    ["abc", 2, null],
    ["1e3", 2, null],
    ["12.3.4", 2, null],
    ["99999999999999999999", 2, null],
  ])("parses %j with %i digits as %j", (input, digits, expected) => {
    expect(parseDecimal(input, digits)).toBe(expected);
  });

  it("round-trips with toDecimalString", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.integer({ min: 0, max: 3 }), (n, d) => {
        expect(parseDecimal(toDecimalString(cents(n), d), d)).toBe(n);
      }),
    );
  });
});
