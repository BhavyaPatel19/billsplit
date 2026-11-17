import { describe, expect, it } from "vitest";
import type { ReceiptExtraction } from "@billsplit/contracts";
import { evaluateReceiptReviewDraft, receiptToReviewDraft } from "./receipt-draft";

const sampleExtraction: ReceiptExtraction = {
  merchant: "La Taqueria",
  date: "2026-11-08",
  currency: "USD",
  items: [
    {
      description: "Al Pastor Tacos",
      quantity: 2,
      unitPriceCents: 450,
      totalPriceCents: 900,
      confidence: "high",
    },
    {
      description: "Horchata",
      quantity: 1,
      unitPriceCents: 350,
      totalPriceCents: 350,
      confidence: "low",
    },
  ],
  subtotalCents: 1250,
  taxCents: 100,
  tipCents: 200,
  feeCents: 50,
  discountCents: 100,
  totalCents: 1500,
};

describe("receiptToReviewDraft & evaluateReceiptReviewDraft", () => {
  it("round-trips an extraction cleanly and reconciles to zero delta", () => {
    let n = 0;
    const draft = receiptToReviewDraft(sampleExtraction, "USD", () => `line-${++n}`);
    expect(draft.merchant).toBe("La Taqueria");
    expect(draft.items).toHaveLength(2);
    expect(draft.items[1]).toMatchObject({
      key: "line-2",
      description: "Horchata",
      totalPrice: "3.50",
      confidence: "low",
    });

    const evaluated = evaluateReceiptReviewDraft(draft);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(evaluated.error);
    expect(evaluated.extraction).toEqual(sampleExtraction);
    expect(evaluated.reconciliation).toEqual({
      matches: true,
      itemsSumCents: 1250,
      computedTotalCents: 1500,
      discrepancyCents: 0,
      reason: null,
    });
  });

  it("reports live reconciliation delta when totals disagree", () => {
    const draft = receiptToReviewDraft(sampleExtraction, "USD", () => "k");
    draft.total = "16.00";
    const evaluated = evaluateReceiptReviewDraft(draft);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) throw new Error(evaluated.error);
    expect(evaluated.reconciliation).toMatchObject({
      matches: false,
      itemsSumCents: 1250,
      computedTotalCents: 1500,
      discrepancyCents: 100,
    });
    expect(evaluated.reconciliation.reason).toBeTruthy();
  });

  it("validates currency, date, and line items", () => {
    const baseDraft = receiptToReviewDraft(sampleExtraction, "USD", () => "k");
    expect(evaluateReceiptReviewDraft({ ...baseDraft, currency: "US" })).toEqual({
      ok: false,
      error: "Currency must be a 3-letter code like USD",
    });
    expect(evaluateReceiptReviewDraft({ ...baseDraft, date: "11/08/2026" })).toEqual({
      ok: false,
      error: "Date must be YYYY-MM-DD",
    });
    expect(
      evaluateReceiptReviewDraft({
        ...baseDraft,
        items: [{ ...baseDraft.items[0]!, description: "  " }],
      }),
    ).toEqual({
      ok: false,
      error: "Item 1: enter a description",
    });
    expect(
      evaluateReceiptReviewDraft({
        ...baseDraft,
        items: [{ ...baseDraft.items[0]!, quantity: "0" }],
      }),
    ).toEqual({
      ok: false,
      error: "Al Pastor Tacos: quantity must be greater than zero",
    });
  });
});
