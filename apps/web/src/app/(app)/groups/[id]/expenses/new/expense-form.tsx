"use client";

import { ExternalLink, Plus, ReceiptText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ExpenseDetailSchema, type GroupDetail, type Receipt } from "@billsplit/contracts";
import { currencyDigits } from "@billsplit/split-engine";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api-client";
import {
  evaluateDraft,
  evenPercents,
  receiptToExpenseDraft,
  type ExpenseDraft,
  type LineDraft,
  type SplitDraft,
} from "@/lib/expense-draft";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

const inputClass =
  "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:border-zinc-700 dark:bg-zinc-900";

let keyCounter = 0;
const newKey = () => `line-${++keyCounter}`;

export function ExpenseForm({
  group,
  initialReceipt = null,
}: {
  group: GroupDetail;
  initialReceipt?: Receipt | null;
}) {
  const router = useRouter();
  const everyone = group.participants.map((p) => p.id);
  const nameOf = useMemo(
    () => new Map(group.participants.map((p) => [p.id, p.isMe ? "You" : p.displayName])),
    [group.participants],
  );
  const digits = currencyDigits(group.currency);

  const newLine = (): LineDraft => ({
    key: newKey(),
    name: "",
    amount: "",
    quantity: "1",
    split: { kind: "equal", people: everyone, values: {} },
  });

  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    initialReceipt?.ocr
      ? receiptToExpenseDraft(initialReceipt, group, newKey)
      : {
          mode: "simple",
          description: "",
          spentOn: new Date().toISOString().slice(0, 10),
          payerId: group.myParticipantId,
          amount: "",
          split: { kind: "equal", people: everyone, values: {} },
          lines: [newLine()],
          tax: "",
          tip: "",
          fee: "",
          discount: "",
        },
  );
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const result = useMemo(
    () => evaluateDraft(draft, group.currency, digits),
    [draft, group.currency, digits],
  );
  const set = (patch: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));

  const submit = async () => {
    setTouched(true);
    if (!result.ok) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await fetchCreate();
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : "Could not save the expense");
      setSubmitting(false);
    }
  };

  const fetchCreate = async () => {
    if (!result.ok) return;
    const res = await fetch(`/api/groups/${group.id}/expenses`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(result.input),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiClientError(res.status, body.error ?? "Could not save the expense");
    }
    const expense = ExpenseDetailSchema.parse(await res.json());
    router.push(`/groups/${group.id}/expenses/${expense.id}`);
    router.refresh();
  };

  const receiptCurrencyMismatch =
    initialReceipt?.ocr?.currency &&
    initialReceipt.ocr.currency.toUpperCase() !== group.currency.toUpperCase();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        {initialReceipt ? (
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {initialReceipt.thumbnailUrl ? (
                  // Presigned S3/RustFS URLs vary per host and expire quickly, so bypass next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={initialReceipt.thumbnailUrl}
                    alt="Receipt preview"
                    className="size-12 rounded border border-zinc-200 object-cover dark:border-zinc-700"
                  />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
                    <ReceiptText className="size-5" aria-hidden />
                  </div>
                )}
                <div className="text-sm">
                  <p className="font-medium">
                    Prefilled from {initialReceipt.ocr?.merchant ?? "scanned receipt"}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Tap people on each item to claim what they had.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link
                  href={`/groups/${group.id}/receipts/${initialReceipt.id}`}
                  className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  Review receipt
                </Link>
                {initialReceipt.imageUrl ? (
                  <a
                    href={initialReceipt.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-zinc-600 hover:underline dark:text-zinc-400"
                  >
                    Image <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>
            </div>
            {initialReceipt.status === "needs_review" ? (
              <Alert tone="error">
                Totals on this receipt did not fully match (
                {initialReceipt.ocr?.reconciliation.reason ?? "check line items"}). Review it
                carefully before saving.
              </Alert>
            ) : null}
            {receiptCurrencyMismatch ? (
              <Alert tone="info">
                Receipt shows {initialReceipt.ocr?.currency}, while this group uses {group.currency}
                . Amounts were imported numerically — convert to {group.currency} if needed.
              </Alert>
            ) : null}
          </Card>
        ) : null}
        <Card className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              What was it?
              <input
                className={inputClass}
                placeholder="Groceries, dinner, Wi-Fi bill"
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Date
              <input
                type="date"
                className={inputClass}
                value={draft.spentOn}
                onChange={(e) => set({ spentOn: e.target.value })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Paid by
            <select
              className={inputClass}
              value={draft.payerId}
              onChange={(e) => set({ payerId: e.target.value })}
            >
              {group.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf.get(p.id)}
                </option>
              ))}
            </select>
          </label>
          <div
            className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800"
            role="tablist"
          >
            {(["simple", "itemized"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={draft.mode === mode}
                onClick={() => set({ mode })}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 font-medium",
                  draft.mode === mode
                    ? "bg-white shadow-sm dark:bg-zinc-950"
                    : "text-zinc-600 dark:text-zinc-400",
                )}
              >
                {mode === "simple" ? "One amount" : "Item by item"}
              </button>
            ))}
          </div>
        </Card>

        {draft.mode === "simple" ? (
          <Card className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Amount ({group.currency})
              <input
                inputMode="decimal"
                className={inputClass}
                placeholder="0.00"
                value={draft.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </label>
            <SplitEditor
              draft={draft.split}
              onChange={(split) => set({ split })}
              everyone={everyone}
              nameOf={nameOf}
              kinds={["equal", "exact", "percent", "shares"]}
            />
          </Card>
        ) : (
          <>
            {draft.lines.map((line, i) => (
              <Card key={line.key} className="flex flex-col gap-3">
                <div className="grid grid-cols-[1fr_7rem_4rem_auto] items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Item
                    <input
                      className={inputClass}
                      placeholder={`Item ${i + 1}`}
                      value={line.name}
                      onChange={(e) => setLine(line.key, { name: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Price
                    <input
                      inputMode="decimal"
                      className={inputClass}
                      placeholder="0.00"
                      value={line.amount}
                      onChange={(e) => setLine(line.key, { amount: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Qty
                    <input
                      inputMode="numeric"
                      className={inputClass}
                      value={line.quantity}
                      onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Remove item"
                    disabled={draft.lines.length === 1}
                    onClick={() => set({ lines: draft.lines.filter((l) => l.key !== line.key) })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                <SplitEditor
                  draft={line.split}
                  onChange={(split) => setLine(line.key, { split })}
                  everyone={everyone}
                  nameOf={nameOf}
                  meId={group.myParticipantId}
                  kinds={["equal", "percent"]}
                  compact
                />
              </Card>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => set({ lines: [...draft.lines, newLine()] })}
            >
              <Plus className="size-4" aria-hidden /> Add item
            </Button>
            <Card className="grid gap-3 sm:grid-cols-4">
              {(["tax", "tip", "fee", "discount"] as const).map((k) => (
                <label
                  key={k}
                  className="flex flex-col gap-1 text-xs font-medium capitalize text-zinc-600 dark:text-zinc-400"
                >
                  {k}
                  <input
                    inputMode="decimal"
                    className={inputClass}
                    placeholder="0.00"
                    value={draft[k]}
                    onChange={(e) => set({ [k]: e.target.value })}
                  />
                </label>
              ))}
              <p className="text-xs text-zinc-500 sm:col-span-4">
                Tax, tip, fees and discounts are shared in proportion to what each person had.
              </p>
            </Card>
          </>
        )}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">Who owes what</h2>
          {result.ok ? (
            <>
              <ul className="flex flex-col gap-1.5 text-sm">
                {Object.entries(result.totals).map(([pid, amount]) => (
                  <li key={pid} className="flex justify-between gap-3">
                    <span>{nameOf.get(pid)}</span>
                    <span className="font-mono tabular-nums">{money(amount, group.currency)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-zinc-200 pt-2 text-sm font-medium dark:border-zinc-800">
                <span>Total</span>
                <span className="font-mono tabular-nums">
                  {money(result.total, group.currency)}
                </span>
              </div>
            </>
          ) : (
            <p className={cn("text-sm", touched ? "text-red-600" : "text-zinc-500")}>
              {result.error}
            </p>
          )}
        </Card>
        {serverError ? <Alert tone="error">{serverError}</Alert> : null}
        <Button size="lg" onClick={submit} loading={submitting} disabled={!result.ok && touched}>
          Save expense
        </Button>
      </aside>
    </div>
  );
}

const KIND_LABEL: Record<SplitDraft["kind"], string> = {
  equal: "Equally",
  exact: "Exact amounts",
  percent: "Percent",
  shares: "Shares",
};

function SplitEditor({
  draft,
  onChange,
  everyone,
  nameOf,
  meId,
  kinds,
  compact = false,
}: {
  draft: SplitDraft;
  onChange: (d: SplitDraft) => void;
  everyone: string[];
  nameOf: Map<string, string>;
  meId?: string;
  kinds: Array<SplitDraft["kind"]>;
  compact?: boolean;
}) {
  const applyPeople = (people: string[]) =>
    onChange({
      ...draft,
      people,
      values: draft.kind === "percent" ? evenPercents(people) : draft.values,
    });
  const toggle = (pid: string) => {
    const people = draft.people.includes(pid)
      ? draft.people.filter((p) => p !== pid)
      : everyone.filter((p) => p === pid || draft.people.includes(p));
    applyPeople(people);
  };
  const allSelected = everyone.length > 0 && draft.people.length === everyone.length;
  const onlyMeSelected =
    meId !== undefined && draft.people.length === 1 && draft.people[0] === meId;
  const setKind = (kind: SplitDraft["kind"]) =>
    onChange({
      ...draft,
      kind,
      values:
        kind === "percent"
          ? evenPercents(draft.people)
          : kind === "shares"
            ? Object.fromEntries(draft.people.map((p) => [p, "1"]))
            : {},
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {compact ? "Who had it" : "Split between"}
        </span>
        {everyone.map((pid) => {
          const on = draft.people.includes(pid);
          return (
            <button
              key={pid}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(pid)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                on
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "border-zinc-300 text-zinc-500 dark:border-zinc-700",
              )}
            >
              {nameOf.get(pid)}
            </button>
          );
        })}
        {compact ? (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyPeople(everyone)}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                allSelected
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
              )}
            >
              Everyone
            </button>
            {meId ? (
              <button
                type="button"
                onClick={() => applyPeople([meId])}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  onlyMeSelected
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                )}
              >
                Just me
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              "rounded px-2 py-1",
              draft.kind === k
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            {k === "percent" && compact ? "Custom % (a bite)" : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {draft.kind !== "equal" && draft.people.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {draft.people.map((pid) => (
            <label key={pid} className="flex items-center gap-2 text-sm">
              <span className="w-24 truncate">{nameOf.get(pid)}</span>
              <input
                inputMode="decimal"
                className={cn(inputClass, "h-9")}
                value={draft.values[pid] ?? ""}
                onChange={(e) =>
                  onChange({ ...draft, values: { ...draft.values, [pid]: e.target.value } })
                }
                aria-label={`${KIND_LABEL[draft.kind]} for ${nameOf.get(pid)}`}
              />
              <span className="w-6 text-xs text-zinc-500">
                {draft.kind === "percent" ? "%" : draft.kind === "shares" ? "×" : ""}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
