import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  cents,
  computeExpense,
  SplitError,
  type ExpenseAdjustment,
  type ExpenseInput,
  type ExpenseItem,
} from "../src/index.js";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof SplitError ? e.code : "not-a-split-error";
  }
}

/** A dinner for three, worked out by hand in docs/adr/0001-money-as-integer-cents.md. */
const dinner: ExpenseInput = {
  currency: "USD",
  payerId: "ana",
  participants: ["ana", "bo", "cy"],
  items: [
    {
      id: "burger",
      name: "Burger",
      amount: cents(1500),
      split: { kind: "equal", participantIds: ["ana"] },
    },
    {
      id: "pizza",
      name: "Pizza",
      amount: cents(2400),
      split: {
        kind: "percent",
        percents: [
          { participantId: "ana", percent: 90 },
          { participantId: "bo", percent: 10 },
        ],
      },
    },
    {
      id: "salad",
      name: "Salad",
      amount: cents(300),
      quantity: 3,
      split: { kind: "equal", participantIds: ["ana", "bo", "cy"] },
    },
  ],
  adjustments: [
    { kind: "tax", amount: cents(396), allocation: "proportional" },
    { kind: "tip", amount: cents(864), allocation: "proportional" },
    { kind: "discount", amount: cents(500), allocation: "equal" },
  ],
};

describe("computeExpense golden example", () => {
  const result = computeExpense(dinner);

  it("totals items with quantity and per-item splits", () => {
    expect(result.items).toEqual([
      { id: "burger", total: 1500, perParticipant: { ana: 1500 } },
      { id: "pizza", total: 2400, perParticipant: { ana: 2160, bo: 240 } },
      { id: "salad", total: 900, perParticipant: { ana: 300, bo: 300, cy: 300 } },
    ]);
    expect(result.itemSubtotals).toEqual({ ana: 3960, bo: 540, cy: 300 });
  });

  it("allocates tax and tip proportionally to what each person had", () => {
    expect(result.adjustments[0]).toEqual({
      kind: "tax",
      amount: 396,
      perParticipant: { ana: 327, bo: 44, cy: 25 },
    });
    expect(result.adjustments[1]).toEqual({
      kind: "tip",
      amount: 864,
      perParticipant: { ana: 713, bo: 97, cy: 54 },
    });
  });

  it("spreads an equal discount with the sign applied", () => {
    expect(result.adjustments[2]).toEqual({
      kind: "discount",
      amount: 500,
      perParticipant: { ana: -167, bo: -167, cy: -166 },
    });
  });

  it("produces per-person totals that reconcile with the receipt", () => {
    expect(result.totals).toEqual({ ana: 4833, bo: 514, cy: 213 });
    expect(result.total).toBe(5560);
    expect(result.total).toBe(4800 + 396 + 864 - 500);
    expect(result.currency).toBe("USD");
    expect(result.payerId).toBe("ana");
  });
});

describe("computeExpense rules", () => {
  const base: ExpenseInput = {
    currency: "USD",
    payerId: "a",
    participants: ["a", "b"],
    items: [],
    adjustments: [],
  };
  const item = (overrides: Partial<ExpenseItem>): ExpenseItem => ({
    id: "x",
    name: "x",
    amount: cents(100),
    split: { kind: "equal", participantIds: ["a", "b"] },
    ...overrides,
  });

  it("gives a payer-allocated fee entirely to the payer", () => {
    const r = computeExpense({
      ...base,
      items: [item({})],
      adjustments: [{ kind: "fee", amount: cents(300), allocation: "payer" }],
    });
    expect(r.adjustments[0]?.perParticipant).toEqual({ a: 300, b: 0 });
    expect(r.totals).toEqual({ a: 350, b: 50 });
  });

  it("falls back to an equal split for proportional adjustments when nobody had anything", () => {
    const r = computeExpense({
      ...base,
      adjustments: [{ kind: "fee", amount: cents(300), allocation: "proportional" }],
    });
    expect(r.totals).toEqual({ a: 150, b: 150 });
  });

  it("keeps participants who had nothing at zero", () => {
    const r = computeExpense({
      ...base,
      participants: ["a", "b", "ghost"],
      items: [item({})],
    });
    expect(r.itemSubtotals.ghost).toBe(0);
    expect(r.totals.ghost).toBe(0);
  });

  it("can go negative when a discount exceeds a share", () => {
    const r = computeExpense({
      ...base,
      items: [item({ amount: cents(10), split: { kind: "equal", participantIds: ["a"] } })],
      adjustments: [{ kind: "discount", amount: cents(10), allocation: "equal" }],
    });
    expect(r.totals).toEqual({ a: 5, b: -5 });
    expect(r.total).toBe(0);
  });

  it.each<[string, Partial<ExpenseInput>]>([
    ["EMPTY_PARTICIPANTS", { participants: [] }],
    ["DUPLICATE_PARTICIPANT", { participants: ["a", "a"] }],
    ["UNKNOWN_PARTICIPANT", { payerId: "nobody" }],
    [
      "UNKNOWN_PARTICIPANT",
      { items: [item({ split: { kind: "equal", participantIds: ["zed"] } })] },
    ],
    ["DUPLICATE_ITEM", { items: [item({}), item({})] }],
    ["NEGATIVE_AMOUNT", { items: [item({ amount: cents(-1) })] }],
    ["INVALID_QUANTITY", { items: [item({ quantity: 0 })] }],
    ["INVALID_QUANTITY", { items: [item({ quantity: 1.5 })] }],
    ["NEGATIVE_AMOUNT", { adjustments: [{ kind: "tax", amount: cents(-1), allocation: "equal" }] }],
    ["INVALID_CENTS", { items: [item({ amount: 1.5 as never })] }],
  ])("rejects with %s", (expected, overrides) => {
    expect(code(() => computeExpense({ ...base, ...overrides }))).toBe(expected);
  });
});

// ---- properties ---------------------------------------------------------------------------

const participantIds = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,5}$/), {
  minLength: 1,
  maxLength: 6,
});

function arbItems(ps: string[]): fc.Arbitrary<ExpenseItem[]> {
  const subset = fc.subarray(ps, { minLength: 1 });
  const arbItem = fc
    .record({
      amount: fc.integer({ min: 0, max: 100_000 }),
      quantity: fc.integer({ min: 1, max: 5 }),
      who: subset,
      mode: fc.constantFrom("equal", "shares", "percent"),
      raw: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 6, maxLength: 6 }),
    })
    .map(({ amount, quantity, who, mode, raw }): ExpenseItem => {
      const id = "item";
      if (mode === "shares") {
        return {
          id,
          name: id,
          amount: cents(amount),
          quantity,
          split: {
            kind: "shares",
            shares: who.map((participantId, j) => ({ participantId, shares: raw[j] ?? 1 })),
          },
        };
      }
      if (mode === "percent") {
        const sum = who.reduce((acc, _, j) => acc + (raw[j] ?? 1), 0);
        const percents = who.map((_, j) => ((raw[j] ?? 1) / sum) * 100);
        return {
          id,
          name: id,
          amount: cents(amount),
          quantity,
          split: {
            kind: "percent",
            percents: who.map((participantId, j) => ({ participantId, percent: percents[j] ?? 0 })),
          },
        };
      }
      return {
        id,
        name: id,
        amount: cents(amount),
        quantity,
        split: { kind: "equal", participantIds: who },
      };
    });
  return fc
    .array(arbItem, { minLength: 0, maxLength: 8 })
    .map((items) => items.map((it, i) => ({ ...it, id: `item-${i}` })));
}

const arbAdjustments: fc.Arbitrary<ExpenseAdjustment[]> = fc.array(
  fc.record({
    kind: fc.constantFrom<ExpenseAdjustment["kind"]>("tax", "tip", "discount", "fee"),
    amount: fc.integer({ min: 0, max: 50_000 }).map(cents),
    allocation: fc.constantFrom<ExpenseAdjustment["allocation"]>("proportional", "equal", "payer"),
  }),
  { maxLength: 5 },
);

const arbExpense: fc.Arbitrary<ExpenseInput> = participantIds.chain((ps) =>
  fc.record({
    currency: fc.constant("USD"),
    payerId: fc.constantFrom(...ps),
    participants: fc.constant(ps),
    items: arbItems(ps),
    adjustments: arbAdjustments,
  }),
);

describe("computeExpense properties", () => {
  it("sum(totals) == sum(items) + tax + tip + fee - discount, for every participant order", () => {
    fc.assert(
      fc.property(arbExpense, (input) => {
        const r = computeExpense(input);
        const itemsTotal = input.items.reduce((acc, it) => acc + it.amount * (it.quantity ?? 1), 0);
        const adj = input.adjustments.reduce(
          (acc, a) => acc + (a.kind === "discount" ? 0 - a.amount : a.amount),
          0,
        );
        const sumTotals = Object.values(r.totals).reduce((a, b) => a + b, 0);
        expect(sumTotals).toBe(itemsTotal + adj);
        expect(r.total).toBe(itemsTotal + adj);
        expect(Object.keys(r.totals)).toEqual(input.participants);
        expect(Object.keys(r.itemSubtotals)).toEqual(input.participants);
        for (const a of r.adjustments) {
          expect(Object.keys(a.perParticipant)).toEqual(input.participants);
        }
      }),
    );
  });

  it("per-participant totals equal subtotal plus adjustment shares", () => {
    fc.assert(
      fc.property(arbExpense, (input) => {
        const r = computeExpense(input);
        for (const p of input.participants) {
          const adj = r.adjustments.reduce((acc, a) => acc + (a.perParticipant[p] ?? 0), 0);
          expect(r.totals[p]).toBe((r.itemSubtotals[p] ?? 0) + adj);
        }
      }),
    );
  });

  it("payer-allocated adjustments never touch anyone but the payer", () => {
    fc.assert(
      fc.property(arbExpense, (input) => {
        const r = computeExpense(input);
        input.adjustments.forEach((a, i) => {
          if (a.allocation !== "payer") return;
          const shares = r.adjustments[i]?.perParticipant ?? {};
          for (const p of input.participants) {
            if (p !== input.payerId) expect(shares[p]).toBe(0);
          }
        });
      }),
    );
  });
});
