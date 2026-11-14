import type { ReceiptExtraction, ReceiptReconciliation } from "@billsplit/contracts";

/**
 * Verifies that extracted line items plus tax, tip, and fees minus discounts equal the printed
 * total (within `toleranceCents`, exact by default). Missing totals or empty item lists always
 * require human review.
 */
export function reconcileReceiptExtraction(
  extraction: ReceiptExtraction,
  toleranceCents = 0,
): ReceiptReconciliation {
  const itemsSumCents = extraction.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const tax = extraction.taxCents ?? 0;
  const tip = extraction.tipCents ?? 0;
  const fees = extraction.feeCents ?? 0;
  const discounts = extraction.discountCents ?? 0;
  const computedTotalCents = itemsSumCents + tax + tip + fees - discounts;

  if (extraction.items.length === 0) {
    return {
      matches: false,
      itemsSumCents,
      computedTotalCents,
      discrepancyCents:
        extraction.totalCents === null ? null : extraction.totalCents - computedTotalCents,
      reason: "No line items were extracted",
    };
  }

  if (extraction.totalCents === null) {
    return {
      matches: false,
      itemsSumCents,
      computedTotalCents,
      discrepancyCents: null,
      reason: "Receipt total could not be read",
    };
  }

  const discrepancyCents = extraction.totalCents - computedTotalCents;
  if (Math.abs(discrepancyCents) > toleranceCents) {
    return {
      matches: false,
      itemsSumCents,
      computedTotalCents,
      discrepancyCents,
      reason: `Items + adjustments (${computedTotalCents}) do not equal total (${extraction.totalCents})`,
    };
  }

  return {
    matches: true,
    itemsSumCents,
    computedTotalCents,
    discrepancyCents,
    reason: null,
  };
}
