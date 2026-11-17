import type {
  AdjustmentInput,
  ExpenseInput,
  GroupDetail,
  Receipt,
  SplitInput,
} from "@billsplit/contracts";
import {
  cents,
  computeExpense,
  currencyDigits,
  parseDecimal,
  splitParticipants,
  SplitError,
  type Split,
} from "@billsplit/split-engine";

/** How one amount is divided in the form. Values are what the user typed. */
export interface SplitDraft {
  kind: SplitInput["kind"];
  people: string[];
  /** Per-person number for exact (money), percent, or shares. */
  values: Record<string, string>;
}

export interface LineDraft {
  key: string;
  name: string;
  amount: string;
  quantity: string;
  split: SplitDraft;
}

export interface ExpenseDraft {
  mode: "simple" | "itemized";
  description: string;
  spentOn: string;
  payerId: string;
  /** Simple mode. */
  amount: string;
  split: SplitDraft;
  /** Itemized mode. */
  lines: LineDraft[];
  tax: string;
  tip: string;
  fee: string;
  discount: string;
}

export type DraftResult =
  | { ok: true; input: ExpenseInput; totals: Record<string, number>; total: number }
  | { ok: false; error: string };

function money(value: string, digits: number, label: string): number {
  const parsed = parseDecimal(value === "" ? "0" : value, digits);
  if (parsed === null || parsed < 0) throw new DraftError(`${label}: enter an amount like 12.50`);
  return parsed;
}

class DraftError extends Error {}

function toSplit(draft: SplitDraft, digits: number, label: string): SplitInput {
  if (draft.people.length === 0) throw new DraftError(`${label}: pick at least one person`);
  switch (draft.kind) {
    case "equal":
      return { kind: "equal", participantIds: draft.people };
    case "exact":
      return {
        kind: "exact",
        amounts: draft.people.map((p) => ({
          participantId: p,
          amount: money(draft.values[p] ?? "", digits, label),
        })),
      };
    case "percent":
      return {
        kind: "percent",
        percents: draft.people.map((p) => {
          const v = Number(draft.values[p] ?? "");
          if (!Number.isFinite(v) || v < 0)
            throw new DraftError(`${label}: percentages must be numbers`);
          return { participantId: p, percent: v };
        }),
      };
    case "shares":
      return {
        kind: "shares",
        shares: draft.people.map((p) => {
          const v = Number(draft.values[p] ?? "");
          if (!Number.isInteger(v) || v < 0)
            throw new DraftError(`${label}: shares must be whole numbers`);
          return { participantId: p, shares: v };
        }),
      };
  }
}

function toEngineSplit(split: SplitInput): Split {
  if (split.kind === "exact") {
    return {
      kind: "exact",
      amounts: split.amounts.map((a) => ({
        participantId: a.participantId,
        amount: cents(a.amount),
      })),
    };
  }
  return split;
}

/**
 * Turn the form state into an API request and preview it with the same split engine the
 * server uses, so what the user sees is exactly what will be stored.
 */
export function evaluateDraft(d: ExpenseDraft, currency: string, digits: number): DraftResult {
  try {
    const description = d.description.trim();
    if (!description) throw new DraftError("Describe the expense");

    let items: ExpenseInput["items"];
    let adjustments: AdjustmentInput[] = [];
    if (d.mode === "simple") {
      const amount = money(d.amount, digits, "Amount");
      if (amount === 0) throw new DraftError("Enter the amount");
      items = [
        {
          name: description,
          amountCents: amount,
          quantity: 1,
          split: toSplit(d.split, digits, "Split"),
        },
      ];
    } else {
      if (d.lines.length === 0) throw new DraftError("Add at least one item");
      items = d.lines.map((line, i) => {
        const label = line.name.trim() || `Item ${i + 1}`;
        const unit = money(line.amount, digits, label);
        const quantity = Number(line.quantity || "1");
        if (!Number.isInteger(quantity) || quantity < 1)
          throw new DraftError(`${label}: quantity must be a whole number`);
        return {
          name: label,
          amountCents: unit,
          quantity,
          split: toSplit(line.split, digits, label),
        };
      });
      adjustments = (
        [
          ["tax", d.tax],
          ["tip", d.tip],
          ["fee", d.fee],
          ["discount", d.discount],
        ] as const
      )
        .map(([kind, value]) => ({
          kind,
          amountCents: money(value, digits, kind),
          allocation: "proportional" as const,
        }))
        .filter((a) => a.amountCents > 0);
    }

    const input: ExpenseInput = {
      description,
      payerId: d.payerId,
      items,
      adjustments,
      ...(d.spentOn ? { spentOn: d.spentOn } : {}),
    };

    const engineItems = items.map((it, i) => ({
      id: String(i),
      name: it.name,
      amount: cents(it.amountCents),
      quantity: it.quantity,
      split: toEngineSplit(it.split),
    }));
    const participants = [
      ...new Set([d.payerId, ...engineItems.flatMap((it) => splitParticipants(it.split))]),
    ];
    const breakdown = computeExpense({
      currency,
      payerId: d.payerId,
      participants,
      items: engineItems,
      adjustments: adjustments.map((a) => ({
        kind: a.kind,
        amount: cents(a.amountCents),
        allocation: a.allocation,
      })),
    });
    return { ok: true, input, totals: breakdown.totals, total: breakdown.total };
  } catch (err) {
    if (err instanceof DraftError || err instanceof SplitError)
      return { ok: false, error: friendly(err) };
    throw err;
  }
}

function friendly(err: Error): string {
  if (err instanceof SplitError) {
    switch (err.code) {
      case "PERCENT_SUM_MISMATCH":
        return "Percentages must add up to 100";
      case "EXACT_SUM_MISMATCH":
        return "The amounts per person must add up to the total";
      case "ZERO_WEIGHTS":
        return "Give at least one person a share";
      default:
        return err.message;
    }
  }
  return err.message;
}

/** Plain decimal string for input fields (`6000, 2 -> "60.00"`, `1200, 0 -> "1200"`). */
export function formatInputAmount(amountCents: number, digits: number): string {
  const neg = amountCents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(amountCents));
  if (digits === 0) return `${neg}${abs}`;
  const factor = 10 ** digits;
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(digits, "0");
  return `${neg}${whole}.${frac}`;
}

/**
 * Turns a scanned receipt's OCR data into an itemized expense draft ready for tap-to-claim.
 * Whole-number quantities whose total divides evenly preserve unit price × qty; fractional or
 * bundled prices fall back to quantity `1` at the full line price so totals always match to the cent.
 */
export function receiptToExpenseDraft(
  receipt: Receipt,
  group: GroupDetail,
  makeKey: () => string,
): ExpenseDraft {
  const ocr = receipt.ocr;
  const everyone = group.participants.map((p) => p.id);
  const digits = currencyDigits(group.currency);
  const spentOn =
    ocr?.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date)
      ? ocr.date
      : new Date().toISOString().slice(0, 10);

  const lines: LineDraft[] =
    ocr && ocr.items.length > 0
      ? ocr.items.map((item) => {
          const integerQty =
            Number.isInteger(item.quantity) &&
            item.quantity >= 1 &&
            item.totalPriceCents % item.quantity === 0;
          const quantity = integerQty ? String(item.quantity) : "1";
          const unitCents = integerQty
            ? item.totalPriceCents / item.quantity
            : item.totalPriceCents;
          const label =
            !integerQty && item.quantity !== 1
              ? `${item.description} (${item.quantity}x)`
              : item.description;
          return {
            key: makeKey(),
            name: label,
            amount: formatInputAmount(Math.max(0, unitCents), digits),
            quantity,
            split: { kind: "equal", people: everyone, values: {} },
          };
        })
      : [
          {
            key: makeKey(),
            name: "",
            amount: "",
            quantity: "1",
            split: { kind: "equal", people: everyone, values: {} },
          },
        ];

  const optAmount = (value: number | null | undefined) =>
    value && value > 0 ? formatInputAmount(value, digits) : "";

  return {
    mode: "itemized",
    description: ocr?.merchant?.trim() || "Receipt",
    spentOn,
    payerId: group.myParticipantId,
    amount: "",
    split: { kind: "equal", people: everyone, values: {} },
    lines,
    tax: optAmount(ocr?.taxCents),
    tip: optAmount(ocr?.tipCents),
    fee: optAmount(ocr?.feeCents),
    discount: optAmount(ocr?.discountCents),
  };
}

/** Equal percentages that add up to exactly 100, the last person absorbing rounding. */
export function evenPercents(people: readonly string[]): Record<string, string> {
  if (people.length === 0) return {};
  const base = Math.floor((100 / people.length) * 100) / 100;
  const out: Record<string, string> = {};
  people.forEach((p, i) => {
    out[p] =
      i === people.length - 1
        ? String(Math.round((100 - base * (people.length - 1)) * 100) / 100)
        : String(base);
  });
  return out;
}
