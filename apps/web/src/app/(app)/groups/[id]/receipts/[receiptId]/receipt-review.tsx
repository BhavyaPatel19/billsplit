"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Plus,
  Receipt as ReceiptIcon,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ReceiptSchema,
  type GroupDetail,
  type OcrConfidence,
  type Receipt,
} from "@billsplit/contracts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api-client";
import { money } from "@/lib/money";
import {
  evaluateReceiptReviewDraft,
  receiptToReviewDraft,
  type ReceiptReviewDraft,
  type ReviewLineDraft,
} from "@/lib/receipt-draft";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:border-zinc-700 dark:bg-zinc-900";

const CONFIDENCE_STYLE: Record<OcrConfidence, { label: string; badge: string; row: string }> = {
  high: {
    label: "High confidence",
    badge: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    row: "border-zinc-200 dark:border-zinc-800",
  },
  medium: {
    label: "Check line",
    badge: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    row: "border-amber-300 bg-amber-50/40 dark:border-amber-800/70 dark:bg-amber-950/20",
  },
  low: {
    label: "Low confidence",
    badge: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    row: "border-red-300 bg-red-50/50 dark:border-red-800/80 dark:bg-red-950/20",
  },
};

let lineCounter = 0;
const nextLineKey = () => `review-line-${++lineCounter}`;

export function ReceiptReview({ group, receipt }: { group: GroupDetail; receipt: Receipt }) {
  const router = useRouter();
  const [currentReceipt, setCurrentReceipt] = useState(receipt);
  const [draft, setDraft] = useState<ReceiptReviewDraft>(() => {
    if (!receipt.ocr) {
      throw new Error("ReceiptReview requires OCR data");
    }
    return receiptToReviewDraft(receipt.ocr, group.currency, nextLineKey);
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"stay" | "split" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const evaluation = useMemo(() => evaluateReceiptReviewDraft(draft), [draft]);
  const displayCurrency =
    (evaluation.ok ? evaluation.extraction.currency : null) ??
    currentReceipt.ocr?.currency ??
    group.currency;

  const updateDraft = (patch: Partial<ReceiptReviewDraft>) => {
    setDirty(true);
    setSavedBanner(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const updateLine = (key: string, patch: Partial<ReviewLineDraft>, verify = true) => {
    setDirty(true);
    setSavedBanner(null);
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.key === key
          ? {
              ...item,
              ...patch,
              confidence: patch.confidence ?? (verify ? "high" : item.confidence),
            }
          : item,
      ),
    }));
  };

  const addLine = () => {
    setDirty(true);
    setSavedBanner(null);
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          key: nextLineKey(),
          description: "",
          quantity: "1",
          unitPrice: "",
          totalPrice: "",
          confidence: "high",
        },
      ],
    }));
  };

  const removeLine = (key: string) => {
    setDirty(true);
    setSavedBanner(null);
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.key !== key),
    }));
  };

  const persist = async (mode: "stay" | "split") => {
    if (!evaluation.ok) {
      setSaveError(evaluation.error);
      return;
    }
    if (mode === "split" && !dirty) {
      router.push(`/groups/${group.id}/expenses/new?receiptId=${currentReceipt.id}`);
      return;
    }

    setSaving(mode);
    setSaveError(null);
    setSavedBanner(null);
    try {
      const res = await fetch(`/api/groups/${group.id}/receipts/${currentReceipt.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(evaluation.extraction),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiClientError(res.status, body.error ?? "Could not save receipt review");
      }
      const updated = ReceiptSchema.parse(await res.json());
      setCurrentReceipt(updated);
      setDirty(false);
      if (mode === "split") {
        router.push(`/groups/${group.id}/expenses/new?receiptId=${updated.id}`);
        router.refresh();
        return;
      }
      setSavedBanner(
        updated.status === "ready"
          ? "Review saved and totals match — ready to split."
          : "Review saved. Some totals still differ from the printed total.",
      );
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : "Could not save receipt review");
    } finally {
      setSaving(null);
    }
  };

  const uncertainCount = draft.items.filter((item) => item.confidence !== "high").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                currentReceipt.status === "ready"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
              )}
            >
              {currentReceipt.status === "ready" ? (
                <CheckCircle2 className="size-3.5" aria-hidden />
              ) : (
                <AlertTriangle className="size-3.5" aria-hidden />
              )}
              {currentReceipt.status === "ready" ? "Ready to split" : "Needs review"}
            </span>
            {currentReceipt.imageUrl ? (
              <a
                href={currentReceipt.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Open full image <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>

          {currentReceipt.imageUrl ? (
            // Presigned S3/RustFS URLs vary per host and expire in 5m, so bypass next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentReceipt.imageUrl}
              alt="Scanned receipt"
              className="max-h-[70vh] w-full rounded-lg border border-zinc-200 bg-zinc-50 object-contain dark:border-zinc-800 dark:bg-zinc-950"
            />
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
              <ReceiptIcon className="size-7 text-zinc-400" aria-hidden />
              Image preview unavailable
            </div>
          )}

          {currentReceipt.ocr ? (
            <p className="text-xs text-zinc-500">
              Extracted with {currentReceipt.ocr.provider} ({currentReceipt.ocr.model})
            </p>
          ) : null}
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        {!evaluation.ok ? (
          <Alert tone="error">{evaluation.error}</Alert>
        ) : evaluation.reconciliation.matches ? (
          <Card className="border-emerald-200 bg-emerald-50/70 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                Totals match
              </span>
              <span className="tabular-nums font-medium">
                Items {money(evaluation.reconciliation.itemsSumCents, displayCurrency)} · Total{" "}
                {money(evaluation.reconciliation.computedTotalCents, displayCurrency)}
              </span>
            </div>
          </Card>
        ) : (
          <Card className="border-amber-300 bg-amber-50/80 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  {evaluation.reconciliation.reason ?? "Totals do not match"}
                </span>
                {evaluation.reconciliation.discrepancyCents !== null ? (
                  <span className="tabular-nums">
                    Delta {evaluation.reconciliation.discrepancyCents >= 0 ? "+" : ""}
                    {money(evaluation.reconciliation.discrepancyCents, displayCurrency)}
                  </span>
                ) : null}
              </div>
              <p className="text-xs opacity-90 tabular-nums">
                Items sum: {money(evaluation.reconciliation.itemsSumCents, displayCurrency)} ·
                Computed total:{" "}
                {money(evaluation.reconciliation.computedTotalCents, displayCurrency)}
              </p>
            </div>
          </Card>
        )}

        <Card className="grid gap-3 sm:grid-cols-[2fr_1fr_96px]">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Merchant
            <input
              className={inputClass}
              placeholder="Store or restaurant name"
              value={draft.merchant}
              onChange={(e) => updateDraft({ merchant: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Receipt date
            <input
              type="date"
              className={inputClass}
              value={draft.date}
              onChange={(e) => updateDraft({ date: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Currency
            <input
              maxLength={3}
              className={cn(inputClass, "uppercase")}
              placeholder="USD"
              value={draft.currency}
              onChange={(e) => updateDraft({ currency: e.target.value.toUpperCase() })}
            />
          </label>
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Line items ({draft.items.length})</h2>
              {uncertainCount > 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {uncertainCount} {uncertainCount === 1 ? "line" : "lines"} flagged for review —
                  double check against the photo.
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 text-xs"
              onClick={addLine}
            >
              <Plus className="size-3.5" aria-hidden /> Add item
            </Button>
          </div>

          {draft.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No items yet. Add at least one item to match the receipt total.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {draft.items.map((item, idx) => {
                const style = CONFIDENCE_STYLE[item.confidence];
                return (
                  <div
                    key={item.key}
                    className={cn("flex flex-col gap-2 rounded-lg border p-3", style.row)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-500">Item {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Confidence for item ${idx + 1}`}
                          value={item.confidence}
                          onChange={(e) =>
                            updateLine(
                              item.key,
                              { confidence: e.target.value as OcrConfidence },
                              false,
                            )
                          }
                          className={cn(
                            "rounded-full border-0 px-2 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600/30",
                            style.badge,
                          )}
                        >
                          <option value="high">High</option>
                          <option value="medium">Check</option>
                          <option value="low">Low</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeLine(item.key)}
                          aria-label={`Remove item ${idx + 1}`}
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_72px_96px_96px]">
                      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Description
                        <input
                          className={inputClass}
                          placeholder="Item name"
                          value={item.description}
                          onChange={(e) => updateLine(item.key, { description: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Qty
                        <input
                          inputMode="decimal"
                          className={inputClass}
                          value={item.quantity}
                          onChange={(e) => updateLine(item.key, { quantity: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Unit price
                        <input
                          inputMode="decimal"
                          className={inputClass}
                          placeholder="Optional"
                          value={item.unitPrice}
                          onChange={(e) => updateLine(item.key, { unitPrice: e.target.value })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Line total
                        <input
                          inputMode="decimal"
                          className={inputClass}
                          placeholder="0.00"
                          value={item.totalPrice}
                          onChange={(e) => updateLine(item.key, { totalPrice: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["subtotal", "Subtotal"],
              ["tax", "Tax"],
              ["tip", "Tip"],
              ["fee", "Fees"],
              ["discount", "Discount"],
              ["total", "Printed total"],
            ] as const
          ).map(([field, label]) => (
            <label
              key={field}
              className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              {label}
              <input
                inputMode="decimal"
                className={inputClass}
                placeholder="0.00"
                value={draft[field]}
                onChange={(e) => updateDraft({ [field]: e.target.value })}
              />
            </label>
          ))}
        </Card>

        {saveError ? <Alert tone="error">{saveError}</Alert> : null}
        {savedBanner ? <Alert tone="info">{savedBanner}</Alert> : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            loading={saving === "stay"}
            disabled={saving !== null || !evaluation.ok}
            onClick={() => void persist("stay")}
          >
            <Save className="size-4" aria-hidden /> Save review
          </Button>
          <Button
            type="button"
            loading={saving === "split"}
            disabled={saving !== null || !evaluation.ok}
            onClick={() => void persist("split")}
          >
            {dirty ? "Save & split items" : "Split items"}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
