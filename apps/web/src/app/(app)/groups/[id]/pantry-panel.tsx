"use client";

import { Minus, Package, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PantryRunSchema, type GroupDetail, type PantryRun } from "@billsplit/contracts";
import { currencyDigits, parseDecimal } from "@billsplit/split-engine";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiClientError } from "@/lib/api-client";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:border-zinc-700 dark:bg-zinc-900";

type Line = { key: number; name: string; amount: string };
let lineKey = 0;
const blankLine = (): Line => ({ key: ++lineKey, name: "", amount: "" });

/**
 * Shared stock from bulk shops. People tap what they used; settling posts one expense split by
 * those taps (items nobody tapped go to everyone who used something).
 */
export function PantryPanel({ group, initial }: { group: GroupDetail; initial: PantryRun[] }) {
  const router = useRouter();
  const [runs, setRuns] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ description: "", lines: [blankLine()] });
  const me = group.myParticipantId;
  const isOwner = group.participants.some((p) => p.isMe && p.role === "owner");
  const digits = currencyDigits(group.currency);
  const name = (pid: string) => {
    const p = group.participants.find((x) => x.id === pid);
    return p ? (p.isMe ? "You" : p.displayName) : "Someone";
  };
  const replace = (run: PantryRun) =>
    setRuns((list) => list.map((r) => (r.id === run.id ? run : r)));
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiClientError ? err.message : fallback);

  const setUse = async (run: PantryRun, itemId: string, units: number) => {
    setBusy(`use:${itemId}`);
    setError(null);
    try {
      replace(
        await api(
          `/groups/${group.id}/pantry/${run.id}/items/${itemId}/uses/${me}`,
          PantryRunSchema,
          {
            method: "PUT",
            body: { units },
          },
        ),
      );
    } catch (err) {
      fail(err, "Could not save that");
    } finally {
      setBusy(null);
    }
  };

  const settle = async (run: PantryRun) => {
    setBusy(`settle:${run.id}`);
    setError(null);
    try {
      replace(
        await api(`/groups/${group.id}/pantry/${run.id}/settle`, PantryRunSchema, { body: {} }),
      );
      router.refresh();
    } catch (err) {
      fail(err, "Could not settle it");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (run: PantryRun) => {
    setBusy(`remove:${run.id}`);
    setError(null);
    try {
      await api(`/groups/${group.id}/pantry/${run.id}`, PantryRunSchema, { method: "DELETE" });
      setRuns((list) => list.filter((r) => r.id !== run.id));
    } catch (err) {
      fail(err, "Could not remove it");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const items = form.lines
      .filter((l) => l.name.trim() || l.amount.trim())
      .map((l) => ({ name: l.name.trim(), amountCents: parseDecimal(l.amount || "0", digits) }));
    if (!form.description.trim()) return setError("Describe the shop, like “Costco run”");
    if (items.length === 0) return setError("Add at least one item");
    if (items.some((i) => !i.name || i.amountCents === null || i.amountCents < 0))
      return setError("Each item needs a name and a price like 12.50");
    setBusy("create");
    setError(null);
    try {
      const run = await api(`/groups/${group.id}/pantry`, PantryRunSchema, {
        body: { description: form.description.trim(), payerId: me, items },
      });
      setRuns((list) => [run, ...list]);
      setForm({ description: "", lines: [blankLine()] });
      setAdding(false);
    } catch (err) {
      fail(err, "Could not stock the pantry");
    } finally {
      setBusy(null);
    }
  };

  const open = runs.filter((r) => r.status === "open");
  const settled = runs.filter((r) => r.status === "settled").slice(0, 5);
  const canManage = (r: PantryRun) => isOwner || r.createdById === me || r.payerId === me;

  return (
    <div id="pantry" className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Pantry</h2>
        <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" aria-hidden /> Stock from a shop
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {adding ? (
        <Card className="flex flex-col gap-3">
          <input
            className={inputClass}
            placeholder="Costco run"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            aria-label="Describe the shop"
          />
          {form.lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_7rem_auto] gap-2">
              <input
                className={inputClass}
                placeholder="Milk ×6"
                value={l.name}
                aria-label="Item"
                onChange={(e) =>
                  setForm({
                    ...form,
                    lines: form.lines.map((x) =>
                      x.key === l.key ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder="0.00"
                value={l.amount}
                aria-label="Price"
                onChange={(e) =>
                  setForm({
                    ...form,
                    lines: form.lines.map((x) =>
                      x.key === l.key ? { ...x, amount: e.target.value } : x,
                    ),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove item"
                disabled={form.lines.length === 1}
                onClick={() =>
                  setForm({ ...form, lines: form.lines.filter((x) => x.key !== l.key) })
                }
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}
            >
              <Plus className="size-4" aria-hidden /> Add item
            </Button>
            <Button size="sm" loading={busy === "create"} onClick={create}>
              Stock it (you paid)
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Scanned a receipt? Open it and choose &ldquo;Stock the pantry&rdquo; to bring in its
            lines, tax and discounts.
          </p>
        </Card>
      ) : null}

      {open.length === 0 && !adding ? (
        <Card className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <Package className="size-5 shrink-0 text-zinc-400" aria-hidden />
          Bulk shop? Stock the pantry, tap what you use, and settle when it runs out.
        </Card>
      ) : null}

      {open.map((run) => (
        <Card key={run.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{run.description}</p>
              <p className="text-xs text-zinc-500">
                {name(run.payerId)} paid {money(run.totalCents, run.currency)} · {run.boughtOn}
              </p>
            </div>
            {canManage(run) ? (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove pantry run"
                  loading={busy === `remove:${run.id}`}
                  onClick={() => remove(run)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
                <Button size="sm" loading={busy === `settle:${run.id}`} onClick={() => settle(run)}>
                  Settle up
                </Button>
              </div>
            ) : null}
          </div>
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
            {run.items.map((item) => {
              const mine = item.uses.find((u) => u.participantId === me)?.units ?? 0;
              const others = item.uses.filter((u) => u.participantId !== me);
              const loading = busy === `use:${item.id}`;
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.name}</p>
                    <p className="text-xs text-zinc-500">
                      {money(item.amountCents, run.currency)}
                      {others.length
                        ? ` · ${others.map((u) => `${name(u.participantId)} ${u.units}`).join(", ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Used less ${item.name}`}
                      disabled={mine === 0 || loading}
                      onClick={() => setUse(run, item.id, mine - 1)}
                    >
                      <Minus className="size-4" aria-hidden />
                    </Button>
                    <span
                      className={cn(
                        "w-6 text-center font-mono text-sm tabular-nums",
                        mine === 0 && "text-zinc-400",
                      )}
                      aria-label="Units you used"
                    >
                      {mine}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`I used some ${item.name}`}
                      disabled={loading || mine >= 99}
                      onClick={() => setUse(run, item.id, mine + 1)}
                    >
                      <Plus className="size-4" aria-hidden /> I used some
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-zinc-500">
            Tap once per unit (2 of the 6 cartons = tap twice). Items nobody taps are shared by
            everyone who used something.
          </p>
        </Card>
      ))}

      {settled.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-zinc-500">
          {settled.map((run) => (
            <li key={run.id}>
              {run.description} settled ·{" "}
              {run.expenseId ? (
                <Link
                  href={`/groups/${group.id}/expenses/${run.expenseId}`}
                  className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  see the split
                </Link>
              ) : (
                "expense deleted"
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
