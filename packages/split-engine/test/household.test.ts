import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allocate,
  cents,
  daysInRange,
  prorate,
  SplitError,
  type DateRange,
  type Resident,
} from "../src/index.js";

const NOV: DateRange = { from: "2026-11-01", to: "2026-11-30" };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SplitError ? e.code : "not a SplitError";
  }
  return "no error";
};

describe("prorate: rent", () => {
  it("charges half a month to someone who moved in on the 16th", () => {
    const { shares, days } = prorate(
      cents(300_000),
      NOV,
      [{ participantId: "ana" }, { participantId: "bo", movedInOn: "2026-11-16" }],
      "rent",
    );
    expect(days).toEqual({ ana: 30, bo: 15 });
    expect(shares).toEqual({ ana: 200_000, bo: 100_000 });
  });

  it("weights by room size", () => {
    const { shares } = prorate(
      cents(240_000),
      NOV,
      [
        { participantId: "ana", weight: 200 },
        { participantId: "bo", weight: 100 },
      ],
      "rent",
    );
    expect(shares).toEqual({ ana: 160_000, bo: 80_000 });
  });

  it("combines room weight with a mid-month move-out and a sublet", () => {
    const { shares, weights } = prorate(
      cents(300_000),
      NOV,
      [
        { participantId: "ana", weight: 2 },
        { participantId: "bo", weight: 1, movedOutOn: "2026-11-10" },
        { participantId: "sub", weight: 1, movedInOn: "2026-11-11" },
      ],
      "rent",
    );
    expect(weights).toEqual({ ana: 60, bo: 10, sub: 20 });
    // 300,000 × 10/90 = 33,333.33 and × 20/90 = 66,666.67: the cent goes to the larger remainder.
    expect(shares).toEqual({ ana: 200_000, bo: 33_333, sub: 66_667 });
  });

  it("ignores trips: you still pay rent while away", () => {
    const { shares } = prorate(
      cents(200_000),
      NOV,
      [
        { participantId: "ana", away: [{ from: "2026-11-01", to: "2026-11-20" }] },
        { participantId: "bo" },
      ],
      "rent",
    );
    expect(shares).toEqual({ ana: 100_000, bo: 100_000 });
  });

  it("counts nothing for someone who lived there outside the period", () => {
    const { shares, days } = prorate(
      cents(100_000),
      NOV,
      [{ participantId: "ana" }, { participantId: "old", movedOutOn: "2026-10-31" }],
      "rent",
    );
    expect(days.old).toBe(0);
    expect(shares).toEqual({ ana: 100_000, old: 0 });
  });
});

describe("prorate: usage", () => {
  it("takes days away off utilities, counting overlapping trips once", () => {
    const { days, shares } = prorate(
      cents(9_000),
      NOV,
      [
        {
          participantId: "ana",
          away: [
            { from: "2026-11-05", to: "2026-11-14" },
            { from: "2026-11-10", to: "2026-11-19" },
          ],
        },
        { participantId: "bo" },
      ],
      "usage",
    );
    // Away Nov 5-19 is 15 days, so present 15 of 30.
    expect(days).toEqual({ ana: 15, bo: 30 });
    expect(shares).toEqual({ ana: 3_000, bo: 6_000 });
  });

  it("only counts days away while living there, and ignores room weight", () => {
    const { days } = prorate(
      cents(1_000),
      NOV,
      [
        {
          participantId: "new",
          weight: 5,
          movedInOn: "2026-11-21",
          // Ten days away, but only Nov 21-25 overlap the stay.
          away: [{ from: "2026-11-16", to: "2026-11-25" }],
        },
        { participantId: "ana" },
      ],
      "usage",
    );
    expect(days).toEqual({ new: 5, ana: 30 });
  });

  it("refuses a bill nobody was home for", () => {
    expect(
      code(() => prorate(cents(500), NOV, [{ participantId: "ana", away: [NOV] }], "usage")),
    ).toBe("ZERO_WEIGHTS");
  });
});

describe("prorate: validation", () => {
  it("rejects bad dates and ranges", () => {
    const one =
      (r: Partial<Resident>, period = NOV) =>
      () =>
        prorate(cents(100), period, [{ participantId: "ana", ...r }], "usage");
    expect(code(one({}, { from: "2026-11-30", to: "2026-11-01" }))).toBe("INVALID_DATE");
    expect(code(one({}, { from: "2026-02-30", to: "2026-03-01" }))).toBe("INVALID_DATE");
    expect(code(one({ movedInOn: "11/16/2026" }))).toBe("INVALID_DATE");
    expect(code(one({ movedInOn: "2026-11-20", movedOutOn: "2026-11-10" }))).toBe("INVALID_DATE");
    expect(code(one({ away: [{ from: "2026-11-09", to: "2026-11-02" }] }))).toBe("INVALID_DATE");
  });

  it("rejects empty, duplicated and badly weighted residents", () => {
    expect(code(() => prorate(cents(1), NOV, [], "rent"))).toBe("EMPTY_PARTICIPANTS");
    expect(
      code(() => prorate(cents(1), NOV, [{ participantId: "a" }, { participantId: "a" }], "rent")),
    ).toBe("DUPLICATE_PARTICIPANT");
    expect(code(() => prorate(cents(1), NOV, [{ participantId: "a", weight: -1 }], "rent"))).toBe(
      "INVALID_WEIGHT",
    );
  });

  it("counts days inclusively, across a leap day", () => {
    expect(daysInRange(NOV)).toBe(30);
    expect(daysInRange({ from: "2028-02-01", to: "2028-02-29" })).toBe(29);
    expect(daysInRange({ from: "2026-11-01", to: "2026-11-01" })).toBe(1);
  });
});

// ---- properties --------------------------------------------------------------------------

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const iso = (day: number) => new Date(START + day * DAY).toISOString().slice(0, 10);

/** A period of 1-62 days somewhere in 2026-2027, as day offsets. */
const periodArb = fc
  .tuple(fc.integer({ min: 0, max: 600 }), fc.integer({ min: 1, max: 62 }))
  .map(([start, len]) => ({ lo: start, hi: start + len - 1 }));

const residentArb = (lo: number, hi: number, i: number) =>
  fc
    .record({
      weight: fc.oneof(fc.constant(1), fc.integer({ min: 0, max: 400 })),
      moveIn: fc.option(fc.integer({ min: lo - 10, max: hi + 10 }), { nil: undefined }),
      stay: fc.option(fc.integer({ min: 0, max: 80 }), { nil: undefined }),
      away: fc.array(
        fc.tuple(fc.integer({ min: lo - 5, max: hi + 5 }), fc.integer({ min: 0, max: 20 })),
        { maxLength: 3 },
      ),
    })
    .map((r): Resident => ({
      participantId: `p${i}`,
      weight: r.weight,
      ...(r.moveIn !== undefined ? { movedInOn: iso(r.moveIn) } : {}),
      ...(r.moveIn !== undefined && r.stay !== undefined
        ? { movedOutOn: iso(r.moveIn + r.stay) }
        : {}),
      away: r.away.map(([a, len]) => ({ from: iso(a), to: iso(a + len) })),
    }));

const caseArb = periodArb.chain(({ lo, hi }) =>
  fc.record({
    period: fc.constant({ from: iso(lo), to: iso(hi) }),
    length: fc.constant(hi - lo + 1),
    residents: fc
      .integer({ min: 1, max: 6 })
      .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => residentArb(lo, hi, i)))),
    amount: fc.integer({ min: 0, max: 5_000_000 }),
    basis: fc.constantFrom("rent" as const, "usage" as const),
  }),
);

describe("prorate: properties", () => {
  it("always sums to the amount, each share within a cent of its exact share", () => {
    fc.assert(
      fc.property(caseArb, ({ period, residents, amount, basis }) => {
        let result;
        try {
          result = prorate(cents(amount), period, residents, basis);
        } catch (e) {
          // The only acceptable failure: nobody (with weight) was there to pay a non-zero bill.
          expect(e).toBeInstanceOf(SplitError);
          expect((e as SplitError).code).toBe("ZERO_WEIGHTS");
          return;
        }
        const ws = residents.map((r) => result.weights[r.participantId]!);
        const sumW = ws.reduce((a, b) => a + b, 0);
        const shares = residents.map((r) => result.shares[r.participantId]!);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
        shares.forEach((s, i) => {
          const exact = sumW === 0 ? 0 : (amount * ws[i]!) / sumW;
          expect(Math.abs(s - exact)).toBeLessThan(1);
        });
      }),
    );
  });

  it("never counts more days than the period or fewer than zero; usage ≤ rent days", () => {
    fc.assert(
      fc.property(caseArb, ({ period, length, residents }) => {
        const rent = prorate(cents(0), period, residents, "rent");
        const usage = prorate(cents(0), period, residents, "usage");
        for (const r of residents) {
          const id = r.participantId;
          expect(rent.days[id]).toBeGreaterThanOrEqual(0);
          expect(rent.days[id]).toBeLessThanOrEqual(length);
          expect(usage.days[id]).toBeGreaterThanOrEqual(0);
          expect(usage.days[id]).toBeLessThanOrEqual(rent.days[id]!);
        }
      }),
    );
  });

  it("reduces to an equal split when everyone is there the whole time", () => {
    fc.assert(
      fc.property(
        periodArb,
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.constantFrom("rent" as const, "usage" as const),
        ({ lo, hi }, n, amount, basis) => {
          const residents = Array.from({ length: n }, (_, i) => ({ participantId: `p${i}` }));
          const { shares } = prorate(
            cents(amount),
            { from: iso(lo), to: iso(hi) },
            residents,
            basis,
          );
          expect(residents.map((r) => shares[r.participantId])).toEqual(
            allocate(
              cents(amount),
              residents.map(() => 1),
            ),
          );
        },
      ),
    );
  });

  it("does not change when every room weight is scaled by the same factor", () => {
    fc.assert(
      fc.property(caseArb, fc.integer({ min: 2, max: 50 }), (c, k) => {
        if (c.basis !== "rent") return;
        const run = (rs: Resident[]) => {
          try {
            return prorate(cents(c.amount), c.period, rs, "rent").shares;
          } catch {
            return null;
          }
        };
        const scaled = c.residents.map((r) => ({ ...r, weight: (r.weight ?? 1) * k }));
        expect(run(scaled)).toEqual(run(c.residents));
      }),
    );
  });

  it("charges someone there longer at least as much, other things equal", () => {
    fc.assert(
      fc.property(
        periodArb,
        fc.integer({ min: 0, max: 61 }),
        fc.integer({ min: 0, max: 61 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        ({ lo, hi }, x, y, amount) => {
          const later = lo + Math.min(Math.max(x, y), hi - lo);
          const earlier = lo + Math.min(Math.min(x, y), hi - lo);
          const period = { from: iso(lo), to: iso(hi) };
          const { shares } = prorate(
            cents(amount),
            period,
            // Listed most-days first: a rounding tie goes to the lower index.
            [
              { participantId: "always" },
              { participantId: "early", movedInOn: iso(earlier) },
              { participantId: "late", movedInOn: iso(later) },
            ],
            "rent",
          );
          expect(shares.early).toBeGreaterThanOrEqual(shares.late!);
          expect(shares.always).toBeGreaterThanOrEqual(shares.early!);
        },
      ),
    );
  });
});

describe("household split inside an expense", () => {
  it("prorates an item and shares tax in proportion", async () => {
    const { computeExpense } = await import("../src/index.js");
    const out = computeExpense({
      currency: "USD",
      payerId: "ana",
      participants: ["ana", "bo"],
      items: [
        {
          id: "rent",
          name: "Rent",
          amount: cents(300_000),
          quantity: 1,
          split: {
            kind: "household",
            basis: "rent",
            period: NOV,
            residents: [{ participantId: "ana" }, { participantId: "bo", movedInOn: "2026-11-16" }],
          },
        },
      ],
      adjustments: [{ kind: "fee", amount: cents(300), allocation: "proportional" }],
    });
    expect(out.totals).toEqual({ ana: 200_200, bo: 100_100 });
    expect(out.total).toBe(300_300);
  });
});
