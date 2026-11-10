import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocate, cents, SplitError, validateWeights } from "../src/index.js";

const total = fc.integer({ min: -10_000_000, max: 10_000_000 });
const weights = fc.array(fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }), {
  minLength: 1,
  maxLength: 12,
});
const positiveWeights = weights.filter((ws) => ws.some((w) => w > 0));

describe("allocate", () => {
  it("splits $100 three ways as 33.34 / 33.33 / 33.33", () => {
    expect(allocate(cents(10000), [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it("handles fractional weights such as a 10% bite", () => {
    expect(allocate(cents(100), [0.1, 0.9])).toEqual([10, 90]);
    expect(allocate(cents(2400), [90, 10])).toEqual([2160, 240]);
  });

  it("gives the leftover units to the largest remainders, lowest index first on ties", () => {
    // exact shares: 3.333.., 3.333.., 3.333.. -> remainder 1 -> index 0
    expect(allocate(cents(10), [1, 1, 1])).toEqual([4, 3, 3]);
    // exact shares: 1.25, 2.5, 1.25 -> floors 1,2,1 (sum 4) -> remainder 1 -> index 1 (.5)
    expect(allocate(cents(5), [1, 2, 1])).toEqual([1, 3, 1]);
  });

  it("gives zero to zero weights", () => {
    expect(allocate(cents(7), [0, 1, 0])).toEqual([0, 7, 0]);
  });

  it("allocates zero across all-zero weights and across no weights", () => {
    expect(allocate(cents(0), [0, 0])).toEqual([0, 0]);
    expect(allocate(cents(0), [])).toEqual([]);
  });

  it("negates for negative totals", () => {
    expect(allocate(cents(-10), [1, 1, 1])).toEqual([-4, -3, -3]);
  });

  it("rejects a non-zero total with nobody to give it to", () => {
    expect(() => allocate(cents(5), [0, 0])).toThrow(SplitError);
    expect(() => allocate(cents(5), [])).toThrow(/all-zero/);
  });

  it.each([[-1], [NaN], [Infinity]])("rejects weight %s", (w) => {
    expect(() => allocate(cents(5), [1, w])).toThrow(SplitError);
    expect(() => validateWeights([w])).toThrow(/finite non-negative/);
  });

  it("rejects a fractional total", () => {
    expect(() => allocate(1.5 as never, [1])).toThrow(SplitError);
  });

  it("validateWeights returns the sum", () => {
    expect(validateWeights([1, 2, 3.5])).toBe(6.5);
    expect(validateWeights([])).toBe(0);
  });

  it("always sums exactly to the total with one share per weight", () => {
    fc.assert(
      fc.property(total, positiveWeights, (t, ws) => {
        const shares = allocate(cents(t), ws);
        expect(shares).toHaveLength(ws.length);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(t);
      }),
    );
  });

  it("keeps every share within one unit of its exact proportional share", () => {
    fc.assert(
      fc.property(total, positiveWeights, (t, ws) => {
        const sum = ws.reduce((a, b) => a + b, 0);
        const shares = allocate(cents(t), ws);
        for (const [i, w] of ws.entries()) {
          const exact = (t * w) / sum;
          expect(Math.abs((shares[i] ?? 0) - exact)).toBeLessThanOrEqual(1 + 1e-6);
          if (w === 0) expect(shares[i]).toBe(0);
        }
      }),
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(total, positiveWeights, (t, ws) => {
        expect(allocate(cents(t), ws)).toEqual(allocate(cents(t), [...ws]));
      }),
    );
  });

  it("is antisymmetric in the sign of the total", () => {
    fc.assert(
      fc.property(total, positiveWeights, (t, ws) => {
        const pos = allocate(cents(t), ws);
        const neg = allocate(cents(-t), ws);
        expect(neg).toEqual(pos.map((s) => 0 - s));
      }),
    );
  });
});
