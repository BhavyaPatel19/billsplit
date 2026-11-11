import { describe, expect, it } from "vitest";
import { evaluateDraft, evenPercents, type ExpenseDraft, type LineDraft } from "./expense-draft";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";

const base = (patch: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  mode: "simple",
  description: "Groceries",
  spentOn: "2026-11-08",
  payerId: A,
  amount: "100",
  split: { kind: "equal", people: [A, B, R], values: {} },
  lines: [],
  tax: "",
  tip: "",
  discount: "",
  ...patch,
});

const line = (
  key: string,
  name: string,
  amount: string,
  people: string[],
  quantity = "1",
): LineDraft => ({
  key,
  name,
  amount,
  quantity,
  split: { kind: "equal", people, values: {} },
});

describe("evaluateDraft (simple)", () => {
  it("splits evenly with the extra cent going to the first person", () => {
    const r = evaluateDraft(base(), "USD", 2);
    expect(r).toMatchObject({
      ok: true,
      total: 10000,
      totals: { [A]: 3334, [B]: 3333, [R]: 3333 },
    });
    if (!r.ok) throw new Error();
    expect(r.input).toMatchObject({
      description: "Groceries",
      payerId: A,
      spentOn: "2026-11-08",
      adjustments: [],
    });
    expect(r.input.items).toEqual([
      {
        name: "Groceries",
        amountCents: 10000,
        quantity: 1,
        split: { kind: "equal", participantIds: [A, B, R] },
      },
    ]);
  });

  it("supports exact, percent and shares", () => {
    expect(
      evaluateDraft(
        base({ split: { kind: "exact", people: [A, B], values: { [A]: "60", [B]: "40" } } }),
        "USD",
        2,
      ),
    ).toMatchObject({ ok: true, totals: { [A]: 6000, [B]: 4000 } });
    expect(
      evaluateDraft(
        base({ split: { kind: "percent", people: [A, B], values: { [A]: "90", [B]: "10" } } }),
        "USD",
        2,
      ),
    ).toMatchObject({ ok: true, totals: { [A]: 9000, [B]: 1000 } });
    expect(
      evaluateDraft(
        base({ split: { kind: "shares", people: [A, B], values: { [A]: "2", [B]: "1" } } }),
        "USD",
        2,
      ),
    ).toMatchObject({ ok: true, totals: { [A]: 6667, [B]: 3333 } });
  });

  it("explains what is wrong in plain words", () => {
    const err = (d: ExpenseDraft) => {
      const r = evaluateDraft(d, "USD", 2);
      return r.ok ? null : r.error;
    };
    expect(err(base({ description: " " }))).toBe("Describe the expense");
    expect(err(base({ amount: "" }))).toBe("Enter the amount");
    expect(err(base({ amount: "12.345" }))).toMatch(/enter an amount/);
    expect(err(base({ split: { kind: "equal", people: [], values: {} } }))).toMatch(
      /pick at least one person/,
    );
    expect(
      err(base({ split: { kind: "percent", people: [A, B], values: { [A]: "50", [B]: "40" } } })),
    ).toBe("Percentages must add up to 100");
    expect(err(base({ split: { kind: "exact", people: [A], values: { [A]: "99" } } }))).toBe(
      "The amounts per person must add up to the total",
    );
    expect(err(base({ split: { kind: "shares", people: [A], values: { [A]: "1.5" } } }))).toMatch(
      /whole numbers/,
    );
    expect(err(base({ split: { kind: "shares", people: [A], values: { [A]: "0" } } }))).toBe(
      "Give at least one person a share",
    );
  });

  it("respects zero-decimal currencies", () => {
    expect(evaluateDraft(base({ amount: "1000" }), "JPY", 0)).toMatchObject({
      ok: true,
      total: 1000,
    });
    expect(evaluateDraft(base({ amount: "10.5" }), "JPY", 0)).toMatchObject({ ok: false });
  });
});

describe("evaluateDraft (itemized)", () => {
  it("matches the worked dinner from ADR 0001 except the discount, which is proportional here", () => {
    const pizza = line("2", "Pizza", "24", [A, B]);
    pizza.split = { kind: "percent", people: [A, B], values: { [A]: "90", [B]: "10" } };
    const r = evaluateDraft(
      base({
        mode: "itemized",
        lines: [line("1", "Burger", "15", [A]), pizza, line("3", "Salad", "3", [A, B, R], "3")],
        tax: "3.96",
        tip: "8.64",
        discount: "5",
      }),
      "USD",
      2,
    );
    expect(r).toMatchObject({ ok: true, total: 5560 });
    if (!r.ok) throw new Error();
    expect(Object.values(r.totals).reduce((a, b) => a + b, 0)).toBe(5560);
    expect(r.input.adjustments).toEqual([
      { kind: "tax", amountCents: 396, allocation: "proportional" },
      { kind: "tip", amountCents: 864, allocation: "proportional" },
      { kind: "discount", amountCents: 500, allocation: "proportional" },
    ]);
    expect(r.input.items[2]).toMatchObject({ name: "Salad", amountCents: 300, quantity: 3 });
  });

  it("names unnamed items and skips empty adjustments", () => {
    const r = evaluateDraft(base({ mode: "itemized", lines: [line("1", "", "5", [A])] }), "USD", 2);
    if (!r.ok) throw new Error(r.error);
    expect(r.input.items[0]!.name).toBe("Item 1");
    expect(r.input.adjustments).toEqual([]);
  });

  it("rejects a bad quantity and an empty list", () => {
    expect(
      evaluateDraft(base({ mode: "itemized", lines: [line("1", "Tea", "2", [A], "0")] }), "USD", 2),
    ).toEqual({
      ok: false,
      error: "Tea: quantity must be a whole number",
    });
    expect(evaluateDraft(base({ mode: "itemized", lines: [] }), "USD", 2)).toEqual({
      ok: false,
      error: "Add at least one item",
    });
  });
});

describe("evenPercents", () => {
  it("adds up to exactly 100", () => {
    for (const n of [1, 2, 3, 6, 7]) {
      const people = Array.from({ length: n }, (_, i) => `p${i}`);
      const sum = Object.values(evenPercents(people)).reduce((a, v) => a + Number(v), 0);
      expect(Math.abs(sum - 100)).toBeLessThan(1e-9);
    }
    expect(evenPercents(["a", "b", "c"])).toEqual({ a: "33.33", b: "33.33", c: "33.34" });
    expect(evenPercents([])).toEqual({});
  });
});
