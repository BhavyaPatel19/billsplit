import { describe, expect, it } from "vitest";
import type { GroupDetail, Receipt } from "@billsplit/contracts";
import {
  evaluateDraft,
  evenPercents,
  formatInputAmount,
  receiptToExpenseDraft,
  type ExpenseDraft,
  type LineDraft,
} from "./expense-draft";

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
  fee: "",
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

describe("formatInputAmount", () => {
  it("formats cents using currency decimal digits", () => {
    expect(formatInputAmount(6000, 2)).toBe("60.00");
    expect(formatInputAmount(5, 2)).toBe("0.05");
    expect(formatInputAmount(-125, 2)).toBe("-1.25");
    expect(formatInputAmount(1200, 0)).toBe("1200");
  });
});

describe("receiptToExpenseDraft", () => {
  const group: GroupDetail = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Dinner",
    currency: "USD",
    memberCount: 3,
    createdAt: "2026-11-08T00:00:00Z",
    myRole: "owner",
    myParticipantId: A,
    participants: [
      {
        id: A,
        displayName: "A",
        userId: null,
        role: "owner",
        isPlaceholder: false,
        isMe: true,
        createdAt: "2026-11-08T00:00:00Z",
      },
      {
        id: B,
        displayName: "B",
        userId: null,
        role: "member",
        isPlaceholder: false,
        isMe: false,
        createdAt: "2026-11-08T00:00:00Z",
      },
      {
        id: R,
        displayName: "R",
        userId: null,
        role: "member",
        isPlaceholder: false,
        isMe: false,
        createdAt: "2026-11-08T00:00:00Z",
      },
    ],
  };

  it("maps items, integer quantities, fees, and adjustments into an itemized draft", () => {
    const receipt: Receipt = {
      id: "55555555-5555-4555-8555-555555555555",
      groupId: group.id,
      status: "ready",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      uploadedBy: A,
      imageUrl: "https://example.com/receipt.jpg",
      thumbnailUrl: "https://example.com/receipt-thumb.jpg",
      sampleId: null,
      error: null,
      createdAt: "2026-11-08T00:00:00Z",
      updatedAt: "2026-11-08T00:00:05Z",
      ocr: {
        provider: "claude",
        model: "claude-test",
        merchant: "La Taqueria",
        date: "2026-11-08",
        currency: "USD",
        items: [
          {
            description: "Street Tacos",
            quantity: 3,
            unitPriceCents: 400,
            totalPriceCents: 1200,
            confidence: "high",
          },
          {
            description: "Bananas",
            quantity: 1.5,
            unitPriceCents: 200,
            totalPriceCents: 300,
            confidence: "medium",
          },
          {
            description: "2-for-5 Cookies",
            quantity: 2,
            unitPriceCents: null,
            totalPriceCents: 500,
            confidence: "high",
          },
        ],
        subtotalCents: 2000,
        taxCents: 160,
        tipCents: 300,
        feeCents: 250,
        discountCents: 100,
        totalCents: 2610,
        reconciliation: {
          matches: true,
          itemsSumCents: 2000,
          computedTotalCents: 2610,
          discrepancyCents: 0,
          reason: null,
        },
      },
    };

    let n = 0;
    const draft = receiptToExpenseDraft(receipt, group, () => `k${++n}`);
    expect(draft.mode).toBe("itemized");
    expect(draft.description).toBe("La Taqueria");
    expect(draft.spentOn).toBe("2026-11-08");
    expect(draft.payerId).toBe(A);
    expect(draft.tax).toBe("1.60");
    expect(draft.tip).toBe("3.00");
    expect(draft.fee).toBe("2.50");
    expect(draft.discount).toBe("1.00");
    expect(draft.lines).toEqual([
      {
        key: "k1",
        name: "Street Tacos",
        amount: "4.00",
        quantity: "3",
        split: { kind: "equal", people: [A, B, R], values: {} },
      },
      {
        key: "k2",
        name: "Bananas (1.5x)",
        amount: "3.00",
        quantity: "1",
        split: { kind: "equal", people: [A, B, R], values: {} },
      },
      {
        key: "k3",
        name: "2-for-5 Cookies",
        amount: "2.50",
        quantity: "2",
        split: { kind: "equal", people: [A, B, R], values: {} },
      },
    ]);

    const evaluated = evaluateDraft(draft, "USD", 2);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(evaluated.error);
    expect(evaluated.total).toBe(2610);
    expect(evaluated.input.adjustments).toEqual([
      { kind: "tax", amountCents: 160, allocation: "proportional" },
      { kind: "tip", amountCents: 300, allocation: "proportional" },
      { kind: "fee", amountCents: 250, allocation: "proportional" },
      { kind: "discount", amountCents: 100, allocation: "proportional" },
    ]);
  });

  it("folds indivisible integer-quantity bundle prices into quantity 1 so totals stay exact", () => {
    const receipt: Receipt = {
      id: "55555555-5555-4555-8555-555555555555",
      groupId: group.id,
      status: "needs_review",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      uploadedBy: A,
      imageUrl: "https://example.com/receipt.jpg",
      thumbnailUrl: "https://example.com/receipt-thumb.jpg",
      sampleId: null,
      error: null,
      createdAt: "2026-11-08T00:00:00Z",
      updatedAt: "2026-11-08T00:00:00Z",
      ocr: {
        provider: "claude",
        model: "claude-test",
        merchant: null,
        date: null,
        currency: null,
        items: [
          {
            description: "3-pack Wings",
            quantity: 3,
            unitPriceCents: null,
            totalPriceCents: 1000,
            confidence: "medium",
          },
        ],
        subtotalCents: 1000,
        taxCents: null,
        tipCents: null,
        feeCents: null,
        discountCents: null,
        totalCents: 1000,
        reconciliation: {
          matches: true,
          itemsSumCents: 1000,
          computedTotalCents: 1000,
          discrepancyCents: 0,
          reason: null,
        },
      },
    };

    const draft = receiptToExpenseDraft(receipt, group, () => "k1");
    expect(draft.description).toBe("Receipt");
    expect(draft.lines[0]).toMatchObject({
      name: "3-pack Wings (3x)",
      amount: "10.00",
      quantity: "1",
    });
    const evaluated = evaluateDraft(draft, "USD", 2);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(evaluated.error);
    expect(evaluated.total).toBe(1000);
  });
});
