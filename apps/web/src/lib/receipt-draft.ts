import {
  reconcileReceiptExtraction,
  type OcrConfidence,
  type ReceiptExtraction,
  type ReceiptReconciliation,
} from "@billsplit/contracts";
import { currencyDigits, parseDecimal } from "@billsplit/split-engine";
import { formatInputAmount } from "./expense-draft";

export interface ReviewLineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  confidence: OcrConfidence;
}

export interface ReceiptReviewDraft {
  merchant: string;
  date: string;
  currency: string;
  items: ReviewLineDraft[];
  subtotal: string;
  tax: string;
  tip: string;
  fee: string;
  discount: string;
  total: string;
}

export type ReviewDraftEvaluation =
  | { ok: true; extraction: ReceiptExtraction; reconciliation: ReceiptReconciliation }
  | { ok: false; error: string };

const optAmount = (cents: number | null, digits: number): string =>
  cents === null ? "" : formatInputAmount(cents, digits);

export function receiptToReviewDraft(
  extraction: ReceiptExtraction,
  fallbackCurrency: string,
  makeKey: () => string,
): ReceiptReviewDraft {
  const currency = extraction.currency?.trim() || fallbackCurrency;
  const digits = currencyDigits(currency);

  return {
    merchant: extraction.merchant ?? "",
    date: extraction.date ?? "",
    currency,
    items: extraction.items.map((item) => ({
      key: makeKey(),
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: optAmount(item.unitPriceCents, digits),
      totalPrice: formatInputAmount(item.totalPriceCents, digits),
      confidence: item.confidence,
    })),
    subtotal: optAmount(extraction.subtotalCents, digits),
    tax: optAmount(extraction.taxCents, digits),
    tip: optAmount(extraction.tipCents, digits),
    fee: optAmount(extraction.feeCents, digits),
    discount: optAmount(extraction.discountCents, digits),
    total: optAmount(extraction.totalCents, digits),
  };
}

function parseRequiredMoney(raw: string, digits: number, label: string): number {
  const trimmed = raw.trim();
  if (!trimmed) throw new ReviewDraftError(`${label}: enter an amount`);
  const parsed = parseDecimal(trimmed, digits);
  if (parsed === null) throw new ReviewDraftError(`${label}: enter a valid amount`);
  return parsed;
}

function parseOptionalMoney(raw: string, digits: number, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parseDecimal(trimmed, digits);
  if (parsed === null) throw new ReviewDraftError(`${label}: enter a valid amount`);
  return parsed;
}

class ReviewDraftError extends Error {}

export function evaluateReceiptReviewDraft(draft: ReceiptReviewDraft): ReviewDraftEvaluation {
  try {
    const currencyTrimmed = draft.currency.trim().toUpperCase();
    const currency = currencyTrimmed ? currencyTrimmed : null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new ReviewDraftError("Currency must be a 3-letter code like USD");
    }
    const digits = currencyDigits(currency ?? "USD");

    const dateTrimmed = draft.date.trim();
    const date = dateTrimmed ? dateTrimmed : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ReviewDraftError("Date must be YYYY-MM-DD");
    }

    const items = draft.items.map((line, index) => {
      const label = line.description.trim();
      if (!label) throw new ReviewDraftError(`Item ${index + 1}: enter a description`);
      const qty = Number(line.quantity.trim() || "1");
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ReviewDraftError(`${label}: quantity must be greater than zero`);
      }
      const unitPriceCents = parseOptionalMoney(line.unitPrice, digits, `${label} unit price`);
      const totalPriceCents = parseRequiredMoney(line.totalPrice, digits, `${label} total`);
      return {
        description: label,
        quantity: qty,
        unitPriceCents,
        totalPriceCents,
        confidence: line.confidence,
      };
    });

    const extraction: ReceiptExtraction = {
      merchant: draft.merchant.trim() || null,
      date,
      currency,
      items,
      subtotalCents: parseOptionalMoney(draft.subtotal, digits, "Subtotal"),
      taxCents: parseOptionalMoney(draft.tax, digits, "Tax"),
      tipCents: parseOptionalMoney(draft.tip, digits, "Tip"),
      feeCents: parseOptionalMoney(draft.fee, digits, "Fee"),
      discountCents: parseOptionalMoney(draft.discount, digits, "Discount"),
      totalCents: parseOptionalMoney(draft.total, digits, "Printed total"),
    };

    return {
      ok: true,
      extraction,
      reconciliation: reconcileReceiptExtraction(extraction),
    };
  } catch (err) {
    if (err instanceof ReviewDraftError) return { ok: false, error: err.message };
    throw err;
  }
}
