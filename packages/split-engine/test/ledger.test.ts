import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyTransfers,
  cents,
  netBalances,
  simplifyDebts,
  SplitError,
  toLedgerEntries,
  type Cents,
  type LedgerEntry,
} from "../src/index.js";

describe("toLedgerEntries", () => {
  it("makes every non-payer owe the payer their total and skips zeros", () => {
    const entries = toLedgerEntries({
      payerId: "ana",
      totals: { ana: cents(4833), bo: cents(514), cy: cents(213), dee: cents(0) },
    });
    expect(entries).toEqual([
      { from: "bo", to: "ana", amount: 514 },
      { from: "cy", to: "ana", amount: 213 },
    ]);
  });

  it("flips direction for a negative total", () => {
    expect(toLedgerEntries({ payerId: "a", totals: { a: cents(5), b: cents(-5) } })).toEqual([
      { from: "a", to: "b", amount: 5 },
    ]);
  });

  it("accepts an explicit payer override and rejects an unknown one", () => {
    const totals = { a: cents(10), b: cents(20) };
    expect(toLedgerEntries({ payerId: "a", totals }, "b")).toEqual([
      { from: "a", to: "b", amount: 10 },
    ]);
    expect(() => toLedgerEntries({ payerId: "a", totals }, "zed")).toThrow(SplitError);
  });
});

describe("netBalances", () => {
  it("nets IOUs into one balance per participant, positive when owed", () => {
    const entries: LedgerEntry[] = [
      { from: "bo", to: "ana", amount: cents(500) },
      { from: "ana", to: "bo", amount: cents(200) },
      { from: "cy", to: "bo", amount: cents(100) },
    ];
    expect(netBalances(entries)).toEqual({ bo: -200, ana: 300, cy: -100 });
  });

  it("is empty for no entries", () => {
    expect(netBalances([])).toEqual({});
  });

  it("rejects fractional amounts", () => {
    expect(() => netBalances([{ from: "a", to: "b", amount: 1.5 as never }])).toThrow(SplitError);
  });
});

describe("simplifyDebts", () => {
  it("settles a triangle in two transfers", () => {
    const balances = { ana: cents(727), bo: cents(-514), cy: cents(-213) };
    expect(simplifyDebts(balances)).toEqual([
      { from: "bo", to: "ana", amount: 514 },
      { from: "cy", to: "ana", amount: 213 },
    ]);
  });

  it("collapses a chain a->b->c into a single transfer", () => {
    const balances = netBalances([
      { from: "a", to: "b", amount: cents(100) },
      { from: "b", to: "c", amount: cents(100) },
    ]);
    expect(balances).toEqual({ a: -100, b: 0, c: 100 });
    expect(simplifyDebts(balances)).toEqual([{ from: "a", to: "c", amount: 100 }]);
  });

  it("breaks amount ties by participant id and ignores key order", () => {
    const a = simplifyDebts({ x: cents(-10), y: cents(-10), p: cents(10), q: cents(10) });
    const b = simplifyDebts({ q: cents(10), y: cents(-10), p: cents(10), x: cents(-10) });
    expect(a).toEqual(b);
    expect(a).toEqual([
      { from: "x", to: "p", amount: 10 },
      { from: "y", to: "q", amount: 10 },
    ]);
  });

  it("returns nothing when everybody is settled", () => {
    expect(simplifyDebts({})).toEqual([]);
    expect(simplifyDebts({ a: cents(0) })).toEqual([]);
  });

  it("rejects balances that do not sum to zero", () => {
    expect(() => simplifyDebts({ a: cents(1) })).toThrow(/sum to 1/);
  });

  it("rejects fractional balances", () => {
    expect(() => simplifyDebts({ a: 0.5 as never })).toThrow(SplitError);
  });
});

describe("applyTransfers", () => {
  it("zeroes the balances it was derived from", () => {
    const balances = { ana: cents(727), bo: cents(-514), cy: cents(-213) };
    expect(applyTransfers(balances, simplifyDebts(balances))).toEqual({ ana: 0, bo: 0, cy: 0 });
  });

  it("adds participants that only appear in transfers", () => {
    expect(applyTransfers({}, [{ from: "a", to: "b", amount: cents(3) }])).toEqual({ a: 3, b: -3 });
  });
});

// ---- properties ---------------------------------------------------------------------------

const ids = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,4}$/), { minLength: 2, maxLength: 7 });
const arbEntries = ids.chain((ps) =>
  fc.array(
    fc
      .record({
        from: fc.constantFrom(...ps),
        to: fc.constantFrom(...ps),
        amount: fc.integer({ min: 1, max: 100_000 }),
      })
      .filter((e) => e.from !== e.to)
      .map((e): LedgerEntry => ({ ...e, amount: cents(e.amount) })),
    { maxLength: 20 },
  ),
);

describe("ledger properties", () => {
  it("net balances always sum to zero", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const sum = Object.values(netBalances(entries)).reduce((a, b) => a + b, 0);
        expect(sum).toBe(0);
      }),
    );
  });

  it("simplifyDebts settles every balance with at most n-1 transfers, all positive", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const balances = netBalances(entries);
        const transfers = simplifyDebts(balances);
        const n = Object.keys(balances).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, n - 1));
        for (const t of transfers) {
          expect(t.amount).toBeGreaterThan(0);
          expect(t.from).not.toBe(t.to);
        }
        const settled = applyTransfers(balances, transfers);
        for (const v of Object.values(settled)) expect(v).toBe(0);
      }),
    );
  });

  it("simplifyDebts never moves more money than the total debt", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const balances = netBalances(entries);
        const totalDebt = Object.values(balances)
          .filter((b) => b < 0)
          .reduce((a, b) => a - b, 0);
        const moved = simplifyDebts(balances).reduce((a, t) => a + t.amount, 0 as number);
        expect(moved).toBe(totalDebt);
      }),
    );
  });

  it("is independent of key order", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const balances = netBalances(entries);
        const reversed = Object.fromEntries(Object.entries(balances).reverse()) as Record<
          string,
          Cents
        >;
        expect(simplifyDebts(reversed)).toEqual(simplifyDebts(balances));
      }),
    );
  });
});
